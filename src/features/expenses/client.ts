import type { ExpenseSplit } from './split.ts';
import { DomainError } from '../../domain/errors.ts';
import { parseLocalDate } from '../../domain/time.ts';
export type Expense = { id: string; groupId: string; title: string; amountCents: number; paidByUid: string; participantUids: string[]; settledUids: string[]; shares: {uid:string;amountCents:number}[]; version: number; createdAtEpochMs: number; dueDate?: string; receiptId?:string; purchasedOn?:string; merchant?:string; category?:string; notes?:string; split?:ExpenseSplit };
export type FinanceTransport = (path:string,method?:'GET'|'POST',body?:unknown)=>Promise<unknown>;
const bad = () => new DomainError('TEMPORARY_UNAVAILABLE','No se pudo leer la respuesta de gastos.');
function record(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw bad();return value as Record<string,unknown>;}
function str(value:unknown):string {if(typeof value!=='string'||!value)throw bad();return value;}
function int(value:unknown,min=0):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw bad();return value;}
function strings(value:unknown):string[] {if(!Array.isArray(value))throw bad();const out=value.map(str);if(new Set(out).size!==out.length)throw bad();return out;}
function expense(value:unknown,groupId:string):Expense {
  const v=record(value);const participantUids=strings(v.participantUids);const settledUids=strings(v.settledUids);if(!participantUids.length||!Array.isArray(v.shares))throw bad();
  const shares=v.shares.map(x=>{const r=record(x);return {uid:str(r.uid),amountCents:int(r.amountCents)};});
  const result={id:str(v.id),groupId:str(v.groupId),title:str(v.title),amountCents:int(v.amountCents,1),paidByUid:str(v.paidByUid),participantUids,settledUids,shares,version:int(v.version,1),createdAtEpochMs:int(v.createdAtEpochMs)};
  if(v.dueDate!==undefined&&!parseLocalDate(v.dueDate))throw bad();
  if(result.groupId!==groupId||settledUids.some(uid=>!participantUids.includes(uid))||shares.length!==participantUids.length||new Set(shares.map(s=>s.uid)).size!==shares.length||shares.some(s=>!participantUids.includes(s.uid))||shares.reduce((sum,s)=>sum+s.amountCents,0)!==result.amountCents)throw bad();const extra:Partial<Expense>={};for(const key of ['receiptId','purchasedOn','merchant','category','notes'] as const){if(v[key]!==undefined)extra[key]=str(v[key]);}if(v.purchasedOn!==undefined&&!parseLocalDate(v.purchasedOn))throw bad();if(v.split!==undefined)extra.split=v.split as ExpenseSplit;return {...result,...extra,...(v.dueDate!==undefined?{dueDate:v.dueDate as string}:{})};
}
export function createFinanceClient(request:FinanceTransport){
  const base=(groupId:string)=>`/v1/groups/${encodeURIComponent(groupId)}/expenses`;
  return {
    async list(groupId:string):Promise<Expense[]>{const v=record(await request(base(groupId)));if(v.currency!=='EUR'||!Array.isArray(v.expenses))throw bad();return v.expenses.map(x=>expense(x,groupId));},
    async create(groupId:string,draft:ExpenseDraft){return expense(record(await request(base(groupId),'POST',draft)).expense,groupId);},
    async update(groupId:string,id:string,draft:ExpenseDraft & {expectedVersion:number}){return expense(record(await request(`${base(groupId)}/${encodeURIComponent(id)}/update`,'POST',draft)).expense,groupId);},
    async uploadReceipt(groupId:string,file:{filename:string;base64:string}):Promise<Receipt>{const response=record(await request(`/v1/groups/${encodeURIComponent(groupId)}/receipts`,'POST',file));if(response.existingExpenseId)throw new DomainError('VERSION_CONFLICT','Este ticket ya tiene un gasto registrado. Búscalo en el historial para verlo o editarlo.');return receipt(response.receipt,groupId);},
    async receipts(groupId:string):Promise<Receipt[]>{const v=record(await request(`/v1/groups/${encodeURIComponent(groupId)}/receipts`));if(!Array.isArray(v.receipts))throw bad();return v.receipts.map(r=>receipt(r,groupId));},
    async receipt(groupId:string,id:string):Promise<Receipt>{return receipt(record(await request(`/v1/groups/${encodeURIComponent(groupId)}/receipts/${encodeURIComponent(id)}`)).receipt,groupId);},
    async retryReceipt(groupId:string,id:string):Promise<Receipt>{return receipt(record(await request(`/v1/groups/${encodeURIComponent(groupId)}/receipts/${encodeURIComponent(id)}/retry`,'POST',{})).receipt,groupId);},
    async previewReceipt(groupId:string,id:string):Promise<string|null>{const v=record(await request(`/v1/groups/${encodeURIComponent(groupId)}/receipts/${encodeURIComponent(id)}/preview`));return typeof v.base64==='string' && ['image/jpeg','image/png'].includes(String(v.mediaType))?`data:${String(v.mediaType)};base64,${v.base64}`:null;},
    async settle(groupId:string,id:string,draft:{operationId:string;expectedVersion:number}){return expense(record(await request(`${base(groupId)}/${encodeURIComponent(id)}/settle`,'POST',draft)).expense,groupId);},
  };
}
export type FinanceClient=ReturnType<typeof createFinanceClient>;
export function expenseBalance(expenses:Expense[],uid:string){let owed=0;let owes=0;for(const e of expenses)for(const share of e.shares){if(e.settledUids.includes(share.uid)||share.uid===e.paidByUid)continue;if(e.paidByUid===uid)owed+=share.amountCents;else if(share.uid===uid)owes+=share.amountCents;}return {owed,owes};}
export const formatEuros=(cents:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(cents/100);
export function parseEuros(value:string):number|null {if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim()))return null;const [whole,fraction='']=value.trim().replace(',','.').split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));return Number.isSafeInteger(cents)&&cents>0&&cents<=100000000?cents:null;}

export type ExpenseDraft={operationId:string;title:string;amountCents:number;participantUids:string[];dueDate?:string;receiptId?:string;purchasedOn?:string;merchant?:string;category?:string;notes?:string;split?:ExpenseSplit};
export type Receipt={id:string;groupId:string;filename:string;status:'queued'|'reading'|'ready'|'failed';result?:{fields:Record<string,{value:string|null;verification:string;evidence?:string}>;text?:string;warnings?:Array<{code:string}>}};
function receipt(value:unknown,groupId:string):Receipt{const v=record(value);if(v.groupId!==groupId||!['queued','reading','ready','failed'].includes(String(v.status)))throw bad();if(v.result!==undefined){const r=record(v.result);const fields=record(r.fields);for(const field of Object.values(fields)){const f=record(field);if(f.value!==null&&typeof f.value!=='string')throw bad();}}return {id:str(v.id),groupId,filename:str(v.filename),status:v.status as Receipt['status'],...(v.result?{result:v.result as Receipt['result']}:{})};}
