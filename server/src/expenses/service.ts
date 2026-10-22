import { DomainError } from '../../../src/domain/errors.ts';
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
};
type ExpenseRow = {
  id: string; group_id: string; title: string; amount_cents: number;
  paid_by_uid: string; version: number; created_at_epoch_ms: number;
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
  assertNoExtraKeys(data, ['operationId', 'title', 'amountCents', 'participantUids']);
  return db.transaction(() => {
    requireActiveMembership(db, groupId, actorUid);
    return operation(db, actorUid, 'createExpense', { ...data, groupId }, now, () => {
      const title = readString(data.title, 'title', { max: 120 });
      const amountCents = readPositiveInt(data.amountCents, 'amountCents');
      if (amountCents > 100000000) throw new DomainError('INVALID_ARGUMENT', 'El importe máximo es 1.000.000 EUR.');
      if (!Array.isArray(data.participantUids) || data.participantUids.length < 1 || data.participantUids.length > 500)
        throw new DomainError('INVALID_ARGUMENT', 'Selecciona entre 1 y 500 participantes.');
      const participants = data.participantUids.map(uid => readIdentifier(uid, 'participantUids')).sort();
      if (new Set(participants).size !== participants.length || !participants.includes(actorUid))
        throw new DomainError('INVALID_ARGUMENT', 'Participantes únicos; quien paga también debe participar.');
      if (participants.some(uid => !isActiveMember(db, groupId, uid)))
        throw new DomainError('INVALID_ARGUMENT', 'Todos los participantes deben pertenecer al piso.');
      const id = generateId('expense');
      db.prepare('INSERT INTO shared_expenses(id,group_id,title,amount_cents,paid_by_uid,created_at_epoch_ms) VALUES(?,?,?,?,?,?)')
        .run(id, groupId, title, amountCents, actorUid, now);
      const base = Math.floor(amountCents / participants.length), remainder = amountCents % participants.length;
      const insert = db.prepare('INSERT INTO expense_participants(expense_id,uid,share_cents,settled_at_epoch_ms) VALUES(?,?,?,?)');
      participants.forEach((uid, index) => {
        const share = base + (index < remainder ? 1 : 0);
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
