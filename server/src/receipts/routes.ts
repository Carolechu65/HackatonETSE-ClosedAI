import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { DomainError } from '../../../src/domain/errors.ts';
import { authenticate } from '../auth/service.ts';
import { requireActiveMembership } from '../groups/service.ts';
import { generateId } from '../lib/ids.ts';
import { asRecord, assertNoExtraKeys, readIdentifier, readString } from '../lib/validation.ts';
import { FixedWindowLimiter } from '../lib/rateLimit.ts';
import type { Db } from '../persistence/db.ts';

export type ReceiptConfig = { url: string; token: string } | null;
type Row = { id:string; group_id:string; actor_uid:string; filename:string; media_type:string; content:Buffer; status:string; result_json:string|null };
const invalid=()=>new DomainError('INVALID_ARGUMENT','Sube una foto JPG o PNG, o un PDF, de hasta 8 MB.');
function dto(row:Row){
  const result=row.result_json?JSON.parse(row.result_json):null;
  if(result)delete result.previewDataUrl;
  return {id:row.id,groupId:row.group_id,filename:row.filename,status:row.status,...(result?{result}:{})};
}

export function receiptRoutes(app:FastifyInstance,db:Db,config:ReceiptConfig, fetcher:typeof fetch=fetch){
  const limiter=new FixedWindowLimiter(15,60*60*1000);
  let running:Promise<void>|null=null; let closed=false;
  if(config) db.prepare("UPDATE expense_receipts SET status='queued' WHERE status='reading'").run();
  async function drain(){
    if(closed||!config)return;
    const row=db.prepare("SELECT * FROM expense_receipts WHERE status='queued' ORDER BY created_at_epoch_ms LIMIT 1").get() as Row|undefined;
    if(!row)return;
    db.prepare("UPDATE expense_receipts SET status='reading' WHERE id=?").run(row.id);
    try{
      const response=await fetcher(`${config.url}/extract`,{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/octet-stream','x-filename':row.id+(row.media_type==='image/jpeg'?'.jpg':row.media_type==='image/png'?'.png':'.pdf')},body:new Uint8Array(row.content),signal:AbortSignal.timeout(115000),redirect:'error'});
      if(!response.ok)throw new Error('ocr unavailable');
      const raw=await response.text();if(raw.length>600000)throw new Error('oversized result');
      const result=asRecord(JSON.parse(raw));if(!result.fields||typeof result.fields!=='object')throw new Error('invalid fields');
      db.prepare("UPDATE expense_receipts SET status='ready',result_json=? WHERE id=?").run(JSON.stringify(result),row.id);
    }catch{db.prepare("UPDATE expense_receipts SET status='failed' WHERE id=?").run(row.id);}
  }
  function tick(){if(!running&&!closed&&config){running=drain().finally(()=>{running=null;});}}
  const timer=config?setInterval(tick,1000):null;timer?.unref();
  app.addHook('onClose',async()=>{closed=true;if(timer)clearInterval(timer);await running;});
  const base='/v1/groups/:groupId/receipts';
  function access(request:{headers:{authorization?:string};params:unknown}){
    const actor=authenticate(db,request.headers.authorization);const params=request.params as {groupId:string;receiptId?:string};
    const groupId=readIdentifier(params.groupId,'groupId');requireActiveMembership(db,groupId,actor.uid);
    return {actor,groupId,receiptId:params.receiptId?readIdentifier(params.receiptId,'receiptId'):undefined};
  }
  function find(groupId:string,id:string){const row=db.prepare('SELECT * FROM expense_receipts WHERE group_id=? AND id=?').get(groupId,id) as Row|undefined;if(!row)throw new DomainError('NOT_FOUND','Ticket no encontrado.');return row;}
  app.post(base,{bodyLimit:12*1024*1024,onRequest:async request=>{access(request);}},async request=>{
    const {actor,groupId}=access(request);const data=asRecord(request.body);assertNoExtraKeys(data,['filename','base64']);
    const filename=readString(data.filename,'filename',{max:150});
    if(typeof data.base64!=='string'||data.base64.length>11200000||!data.base64.length||data.base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(data.base64))throw invalid();
    const content=Buffer.from(data.base64,'base64');if(content.length>8*1024*1024||content.length<8)throw invalid();
    const mime=content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':content[0]===255&&content[1]===216&&content[2]===255?'image/jpeg':content.subarray(0,5).toString()==='%PDF-'?'application/pdf':null;
    if(!mime)throw invalid();
    const hash=createHash('sha256').update(content).digest('hex');
    const prior=db.prepare('SELECT * FROM expense_receipts WHERE group_id=? AND actor_uid=? AND sha256=?').get(groupId,actor.uid,hash) as Row|undefined;
    if(prior)return {receipt:dto(prior)};
    limiter.check(actor.uid);
    const queued=(db.prepare("SELECT count(*) AS n FROM expense_receipts WHERE status IN ('queued','reading')").get() as {n:number}).n;
    if(queued>=20)throw new DomainError('RATE_LIMITED','Hay varios tickets en espera. Vuelve a intentarlo en unos minutos.');
    const id=generateId('receipt'),name=filename.replace(/[^\p{L}\p{N}._ -]/gu,'_').replace(/\.[^.]+$/,'')+(mime==='image/jpeg'?'.jpg':mime==='image/png'?'.png':'.pdf');
    db.prepare('INSERT INTO expense_receipts(id,group_id,actor_uid,sha256,filename,media_type,content,status,created_at_epoch_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(id,groupId,actor.uid,hash,name,mime,content,config?'queued':'failed',Date.now());
    tick();return {receipt:dto(find(groupId,id))};
  });
  app.get(base,async request=>{const {actor,groupId}=access(request);const rows=db.prepare('SELECT id,group_id,filename,status,result_json FROM expense_receipts WHERE group_id=? AND actor_uid=? AND id NOT IN (SELECT receipt_id FROM shared_expenses WHERE receipt_id IS NOT NULL) ORDER BY created_at_epoch_ms DESC LIMIT 20').all(groupId,actor.uid) as Row[];return {receipts:rows.map(dto)};});
  function readable(actorUid:string,groupId:string,id:string){const row=find(groupId,id);if(row.actor_uid!==actorUid&&!db.prepare('SELECT 1 FROM shared_expenses WHERE receipt_id=? AND group_id=?').get(id,groupId))throw new DomainError('NOT_FOUND','Ticket no encontrado.');return row;}
  app.get(`${base}/:receiptId`,async request=>{const {actor,groupId,receiptId}=access(request);return {receipt:dto(readable(actor.uid,groupId,receiptId!))};});
  app.get(`${base}/:receiptId/image`,async(request,reply)=>{const {actor,groupId,receiptId}=access(request);const row=readable(actor.uid,groupId,receiptId!);return reply.type(row.media_type).header('content-disposition','attachment; filename="ticket'+(row.media_type==='application/pdf'?'.pdf':row.media_type==='image/png'?'.png':'.jpg')+'"').send(row.content);});
  // A preview fits the existing authenticated JSON transport. Originals remain private.
  app.get(`${base}/:receiptId/preview`,async request=>{const {actor,groupId,receiptId}=access(request);const row=readable(actor.uid,groupId,receiptId!);const result=row.result_json?JSON.parse(row.result_json):{};if(typeof result.previewDataUrl==='string'&&result.previewDataUrl.startsWith('data:image/jpeg;base64,'))return {mediaType:'image/jpeg',base64:result.previewDataUrl.split(',')[1]};if(row.content.length>700000)return {mediaType:row.media_type,base64:null};return {mediaType:row.media_type,base64:row.content.toString('base64')};});
  app.post(`${base}/:receiptId/retry`,async request=>{const {actor,groupId,receiptId}=access(request);const row=find(groupId,receiptId!);if(row.actor_uid!==actor.uid)throw new DomainError('FORBIDDEN','Solo quien subió el ticket puede repetir la lectura.');if(!config)throw new DomainError('TEMPORARY_UNAVAILABLE','Lectura no disponible.');if(row.status==='failed'){if((db.prepare("SELECT count(*) AS n FROM expense_receipts WHERE status IN ('queued','reading')").get() as {n:number}).n>=20)throw new DomainError('RATE_LIMITED','Hay varios tickets en espera.');limiter.check(actor.uid);db.prepare("UPDATE expense_receipts SET status='queued' WHERE id=?").run(row.id);tick();}return {receipt:dto(find(groupId,row.id))};});
}
