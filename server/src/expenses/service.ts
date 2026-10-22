import { allocateExpense, type ExpenseSplit } from '../../../src/features/expenses/split.ts';
import { DomainError } from '../../../src/domain/errors.ts';
import { parseLocalDate } from '../../../src/domain/time.ts';
import { requireActiveMembership, isActiveMember } from '../groups/service.ts';
import { canonicalJson, sha256Hex } from '../lib/crypto.ts';
import { generateId } from '../lib/ids.ts';
import { asRecord, assertNoExtraKeys, readIdentifier, readPositiveInt, readString } from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';

export type SharedExpense = {
  id: string;
  groupId: string;
  title: string;
  amountCents: number;
  paidByUid: string;
  participantUids: string[];
  settledUids: string[];
  shares: Array<{ uid: string; amountCents: number }>;
  version: number;
  createdAtEpochMs: number;
  dueDate?: string;
  receiptId?:string; purchasedOn?:string; merchant?:string; category?:string; notes?:string; split?:ExpenseSplit;
};
type ExpenseRow = {
  id: string; group_id: string; title: string; amount_cents: number;
  paid_by_uid: string; version: number; created_at_epoch_ms: number; due_date: string | null; receipt_id:string|null; purchased_on:string|null; merchant:string|null; category:string|null; notes:string|null; split_json:string|null;
};
function expenseDto(db: Db, row: ExpenseRow): SharedExpense {
  const participants = db.prepare(
    'SELECT uid,share_cents,settled_at_epoch_ms FROM expense_participants WHERE expense_id=? ORDER BY uid',
  ).all(row.id) as Array<{ uid: string; share_cents: number; settled_at_epoch_ms: number | null }>;
  return {
    id: row.id, groupId: row.group_id, title: row.title, amountCents: row.amount_cents,
    paidByUid: row.paid_by_uid, participantUids: participants.map(p => p.uid),
    settledUids: participants.filter(p => p.settled_at_epoch_ms !== null).map(p => p.uid),
    shares: participants.map(p => ({ uid: p.uid, amountCents: p.share_cents })),
    version: row.version, createdAtEpochMs: row.created_at_epoch_ms,
    ...(row.receipt_id?{receiptId:row.receipt_id}:{}),
    ...(row.purchased_on?{purchasedOn:row.purchased_on}:{}),
    ...(row.merchant?{merchant:row.merchant}:{}),
    ...(row.category?{category:row.category}:{}),
    ...(row.notes?{notes:row.notes}:{}),
    ...(row.split_json?{split:JSON.parse(row.split_json) as ExpenseSplit}:{}),
    ...(row.due_date ? { dueDate: row.due_date } : {}),
  };
}
function findExpense(db: Db, groupId: string, expenseId: string): ExpenseRow {
  const row = db.prepare('SELECT * FROM shared_expenses WHERE group_id=? AND id=?')
    .get(groupId, expenseId) as ExpenseRow | undefined;
  if (!row) throw new DomainError('NOT_FOUND', 'Gasto no encontrado.');
  return row;
}
// Called within the same SQLite transaction as the ledger mutation. The actor,
// route IDs and full input bind a replay to exactly the original operation.
function operation(db: Db, actorUid: string, kind: string, input: Record<string, unknown>, now: number,
  action: () => SharedExpense): SharedExpense {
  const operationId = readIdentifier(input.operationId, 'operationId');
  const digest = sha256Hex(canonicalJson(input));
  const prior = db.prepare('SELECT operation_name,input_hash,result_json FROM operations WHERE actor_uid=? AND operation_id=?')
    .get(actorUid, operationId) as { operation_name: string; input_hash: string; result_json: string } | undefined;
  if (prior) {
    if (prior.operation_name !== kind || prior.input_hash !== digest)
      throw new DomainError('VERSION_CONFLICT', 'operationId reutilizado con otra entrada.');
    return JSON.parse(prior.result_json) as SharedExpense;
  }
  const result = action();
  db.prepare('INSERT INTO operations(actor_uid,operation_id,operation_name,input_hash,result_json,created_at_epoch_ms) VALUES(?,?,?,?,?,?)')
    .run(actorUid, operationId, kind, digest, JSON.stringify(result), now);
  return result;
}
export function listExpenses(db: Db, actorUid: string, groupId: string): { currency: 'EUR'; expenses: SharedExpense[] } {
  requireActiveMembership(db, groupId, actorUid);
  const rows = db.prepare('SELECT * FROM shared_expenses WHERE group_id=? ORDER BY created_at_epoch_ms DESC,id').all(groupId) as ExpenseRow[];
  return { currency: 'EUR', expenses: rows.map(row => expenseDto(db, row)) };
}
export function createExpense(db: Db, actorUid: string, groupId: string, raw: unknown, now = Date.now()): SharedExpense {
  const data = asRecord(raw);
  assertNoExtraKeys(data, ['operationId', 'title', 'amountCents', 'participantUids', 'dueDate','receiptId','purchasedOn','merchant','category','notes','split']);
  return db.transaction(() => {
    requireActiveMembership(db, groupId, actorUid);
    return operation(db, actorUid, 'createExpense', { ...data, groupId }, now, () => {
      const title = readString(data.title, 'title', { max: 120 });
      const amountCents = readPositiveInt(data.amountCents, 'amountCents');
      if (data.dueDate !== undefined && !parseLocalDate(data.dueDate))
        throw new DomainError('INVALID_ARGUMENT', 'La fecha límite debe ser una fecha válida con formato AAAA-MM-DD.');
      const dueDate = data.dueDate === undefined ? null : data.dueDate as string;
      if (amountCents > 100000000) throw new DomainError('INVALID_ARGUMENT', 'El importe máximo es 1.000.000 EUR.');
      if (!Array.isArray(data.participantUids) || data.participantUids.length < 1 || data.participantUids.length > 500)
        throw new DomainError('INVALID_ARGUMENT', 'Selecciona entre 1 y 500 participantes.');
      const participants = data.participantUids.map(uid => readIdentifier(uid, 'participantUids')).sort();
      if (new Set(participants).size !== participants.length)
        throw new DomainError('INVALID_ARGUMENT', 'Los participantes deben ser únicos.');
      if (participants.some(uid => !isActiveMember(db, groupId, uid)))
        throw new DomainError('INVALID_ARGUMENT', 'Todos los participantes deben pertenecer al piso.');
      const details = expenseDetails(db,groupId,actorUid,data);
      const shares = allocation(amountCents,participants,data.split);
      const id = generateId('expense');
      db.prepare('INSERT INTO shared_expenses(id,group_id,title,amount_cents,paid_by_uid,created_at_epoch_ms,due_date) VALUES(?,?,?,?,?,?,?)')
        .run(id, groupId, title, amountCents, actorUid, now, dueDate);
      db.prepare('UPDATE shared_expenses SET receipt_id=?,purchased_on=?,merchant=?,category=?,notes=?,split_json=? WHERE id=?').run(details.receiptId,details.purchasedOn,details.merchant,details.category,details.notes,details.split,id);
      const insert = db.prepare('INSERT INTO expense_participants(expense_id,uid,share_cents,settled_at_epoch_ms) VALUES(?,?,?,?)');
      shares.forEach(({uid,amountCents:share}) => {
        insert.run(id, uid, share, uid === actorUid || share === 0 ? now : null);
      });
      return expenseDto(db, findExpense(db, groupId, id));
    });
  })();
}
export function settleExpense(db: Db, actorUid: string, groupId: string, expenseId: string, raw: unknown, now = Date.now()): SharedExpense {
  const data = asRecord(raw);
  assertNoExtraKeys(data, ['operationId', 'expectedVersion']);
  return db.transaction(() => {
    requireActiveMembership(db, groupId, actorUid);
    const row = findExpense(db, groupId, expenseId);
    const participant = db.prepare('SELECT settled_at_epoch_ms FROM expense_participants WHERE expense_id=? AND uid=?')
      .get(expenseId, actorUid) as { settled_at_epoch_ms: number | null } | undefined;
    if (!participant || row.paid_by_uid === actorUid)
      throw new DomainError('FORBIDDEN', 'Solo puedes liquidar tu propia cuota de un gasto pagado por otra persona.');
    return operation(db, actorUid, 'settleExpense', { ...data, groupId, expenseId }, now, () => {
      const expectedVersion = readPositiveInt(data.expectedVersion, 'expectedVersion');
      if (row.version !== expectedVersion)
        throw new DomainError('VERSION_CONFLICT', 'El gasto ha cambiado. Actualiza antes de liquidar tu cuota.');
      if (participant.settled_at_epoch_ms === null) {
        db.prepare('UPDATE expense_participants SET settled_at_epoch_ms=? WHERE expense_id=? AND uid=?').run(now, expenseId, actorUid);
        db.prepare('UPDATE shared_expenses SET version=version+1 WHERE id=?').run(expenseId);
      }
      return expenseDto(db, findExpense(db, groupId, expenseId));
    });
  })();
}

function allocation(total:number,participants:string[],raw:unknown){
  try{return allocateExpense(total,participants,raw===undefined?undefined:raw as ExpenseSplit);}catch(e){throw new DomainError('INVALID_ARGUMENT',e instanceof Error?e.message:'Reparto no válido.');}
}
function expenseDetails(db:Db,groupId:string,actorUid:string,data:Record<string,unknown>,existingId?:string){
  const optional=(key:string,max:number)=>data[key]===undefined?null:readString(data[key],key,{max});
  const purchasedOn=optional('purchasedOn',10);
  if(purchasedOn&&!parseLocalDate(purchasedOn))throw new DomainError('INVALID_ARGUMENT','Fecha de compra no válida.');
  const receiptId=data.receiptId===undefined?null:readIdentifier(data.receiptId,'receiptId');
  if(receiptId){
    const receipt=db.prepare('SELECT actor_uid FROM expense_receipts WHERE id=? AND group_id=?').get(receiptId,groupId) as {actor_uid:string}|undefined;
    if(!receipt||receipt.actor_uid!==actorUid)throw new DomainError('NOT_FOUND','Ticket no encontrado.');
    const used=db.prepare('SELECT id FROM shared_expenses WHERE receipt_id=?').get(receiptId) as {id:string}|undefined;
    if(used&&used.id!==existingId)throw new DomainError('VERSION_CONFLICT','Este ticket ya tiene un gasto registrado.');
  }
  return {receiptId,purchasedOn,merchant:optional('merchant',120),category:optional('category',60),notes:optional('notes',2000),split:data.split===undefined?null:JSON.stringify(data.split)};
}
export function updateExpense(db:Db,actorUid:string,groupId:string,expenseId:string,raw:unknown,now=Date.now()):SharedExpense{
  const data=asRecord(raw);
  assertNoExtraKeys(data,['operationId','expectedVersion','title','amountCents','participantUids','dueDate','receiptId','purchasedOn','merchant','category','notes','split']);
  return db.transaction(()=>{
    requireActiveMembership(db,groupId,actorUid);
    const row=findExpense(db,groupId,expenseId);
    if(row.paid_by_uid!==actorUid)throw new DomainError('FORBIDDEN','Solo quien registró el gasto puede editarlo.');
    return operation(db,actorUid,'updateExpense',{...data,groupId,expenseId},now,()=>{
      if(row.version!==readPositiveInt(data.expectedVersion,'expectedVersion'))throw new DomainError('VERSION_CONFLICT','El gasto ha cambiado.');
      const paid=db.prepare('SELECT 1 FROM expense_participants WHERE expense_id=? AND uid<>? AND share_cents>0 AND settled_at_epoch_ms IS NOT NULL').get(expenseId,actorUid);
      if(paid)throw new DomainError('VERSION_CONFLICT','Ya hay cuotas liquidadas. El gasto conserva su reparto.');
      const title=readString(data.title,'title',{max:120});const total=readPositiveInt(data.amountCents,'amountCents');
      if(total>100000000||!Array.isArray(data.participantUids)||data.participantUids.length<1||data.participantUids.length>500)throw new DomainError('INVALID_ARGUMENT','Importe o participantes no válidos.');
      const participants=data.participantUids.map(uid=>readIdentifier(uid,'participantUids')).sort();
      if(participants.some(uid=>!isActiveMember(db,groupId,uid)))throw new DomainError('INVALID_ARGUMENT','Participante no activo.');
      const shares=allocation(total,participants,data.split);
      const details=expenseDetails(db,groupId,actorUid,data,expenseId);
      if(data.dueDate!==undefined&&!parseLocalDate(data.dueDate))throw new DomainError('INVALID_ARGUMENT','Fecha límite no válida.');
      // A linked original remains attached throughout edits.
      if(row.receipt_id&&details.receiptId!==row.receipt_id)throw new DomainError('INVALID_ARGUMENT','Conserva el ticket original del gasto.');
      db.prepare('INSERT INTO expense_revisions VALUES(?,?,?,?,?)').run(expenseId,row.version,actorUid,JSON.stringify(expenseDto(db,row)),now);
      db.prepare('UPDATE shared_expenses SET title=?,amount_cents=?,due_date=?,receipt_id=?,purchased_on=?,merchant=?,category=?,notes=?,split_json=?,version=version+1 WHERE id=?').run(title,total,data.dueDate??null,details.receiptId,details.purchasedOn,details.merchant,details.category,details.notes,details.split,expenseId);
      db.prepare('DELETE FROM expense_participants WHERE expense_id=?').run(expenseId);
      const insert=db.prepare('INSERT INTO expense_participants VALUES(?,?,?,?)');
      for(const share of shares)insert.run(expenseId,share.uid,share.amountCents,share.uid===actorUid||share.amountCents===0?now:null);
      return expenseDto(db,findExpense(db,groupId,expenseId));
    });
  })();
}
