import { DomainError } from '../../domain/errors.ts';
export type Expense = { id: string; groupId: string; title: string; amountCents: number; paidByUid: string; participantUids: string[]; settledUids: string[]; shares: {uid:string;amountCents:number}[]; version: number; createdAtEpochMs: number };
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
  if(result.groupId!==groupId||!participantUids.includes(result.paidByUid)||settledUids.some(uid=>!participantUids.includes(uid))||shares.length!==participantUids.length||new Set(shares.map(s=>s.uid)).size!==shares.length||shares.some(s=>!participantUids.includes(s.uid))||shares.reduce((sum,s)=>sum+s.amountCents,0)!==result.amountCents)throw bad();return result;
}
export function createFinanceClient(request:FinanceTransport){
  const base=(groupId:string)=>`/v1/groups/${encodeURIComponent(groupId)}/expenses`;
  return {
    async list(groupId:string):Promise<Expense[]>{const v=record(await request(base(groupId)));if(v.currency!=='EUR'||!Array.isArray(v.expenses))throw bad();return v.expenses.map(x=>expense(x,groupId));},
    async create(groupId:string,draft:{operationId:string;title:string;amountCents:number;participantUids:string[]}){return expense(record(await request(base(groupId),'POST',draft)).expense,groupId);},
    async settle(groupId:string,id:string,draft:{operationId:string;expectedVersion:number}){return expense(record(await request(`${base(groupId)}/${encodeURIComponent(id)}/settle`,'POST',draft)).expense,groupId);},
  };
}
export type FinanceClient=ReturnType<typeof createFinanceClient>;
export function expenseBalance(expenses:Expense[],uid:string){let owed=0;let owes=0;for(const e of expenses)for(const share of e.shares){if(e.settledUids.includes(share.uid)||share.uid===e.paidByUid)continue;if(e.paidByUid===uid)owed+=share.amountCents;else if(share.uid===uid)owes+=share.amountCents;}return {owed,owes};}
export const formatEuros=(cents:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(cents/100);
export function parseEuros(value:string):number|null {if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim()))return null;const [whole,fraction='']=value.trim().replace(',','.').split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));return Number.isSafeInteger(cents)&&cents>0&&cents<=100000000?cents:null;}
