import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/service.ts';
import { readIdentifier } from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';
import { createExpense, listExpenses, settleExpense } from './service.ts';

export function expenseRoutes(app: FastifyInstance, db: Db): void {
  app.get('/v1/groups/:groupId/expenses', async request => {
    const actor = authenticate(db, request.headers.authorization);
    const { groupId } = request.params as { groupId: string };
    return listExpenses(db, actor.uid, readIdentifier(groupId, 'groupId'));
  });
  app.post('/v1/groups/:groupId/expenses', async request => {
    const actor = authenticate(db, request.headers.authorization);
    const { groupId } = request.params as { groupId: string };
    return { expense: createExpense(db, actor.uid, readIdentifier(groupId, 'groupId'), request.body) };
  });
  app.post('/v1/groups/:groupId/expenses/:expenseId/settle', async request => {
    const actor = authenticate(db, request.headers.authorization);
    const { groupId, expenseId } = request.params as { groupId: string; expenseId: string };
    return { expense: settleExpense(db, actor.uid, readIdentifier(groupId, 'groupId'), readIdentifier(expenseId, 'expenseId'), request.body) };
  });
}
