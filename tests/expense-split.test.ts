import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateExpense, type ExpenseSplit } from '../src/features/expenses/split.ts';

test('expense allocation: equal shares conserve every cent regardless of participant order', () => {
  assert.deepEqual(allocateExpense(100, ['c', 'a', 'b']), [{ uid: 'a', amountCents: 34 }, { uid: 'b', amountCents: 33 }, { uid: 'c', amountCents: 33 }]);
  assert.deepEqual(allocateExpense(1, ['b', 'a']), [{ uid: 'a', amountCents: 1 }, { uid: 'b', amountCents: 0 }]);
});

test('expense allocation: exact amounts support zero shares and reject missing or excess cents', () => {
  const values = [{ uid: 'b', value: 101 }, { uid: 'a', value: 0 }];
  assert.deepEqual(allocateExpense(101, ['a', 'b'], { mode: 'exact', values }), [{ uid: 'a', amountCents: 0 }, { uid: 'b', amountCents: 101 }]);
  for (const total of [100, 102]) assert.throws(() => allocateExpense(total, ['a', 'b'], { mode: 'exact', values }));
});

test('expense allocation: percentage rounding awards remaining cents by remainder and deterministic tie-break', () => {
  const split: ExpenseSplit = { mode: 'percentage', values: [{ uid: 'c', value: 3334 }, { uid: 'b', value: 3333 }, { uid: 'a', value: 3333 }] };
  assert.deepEqual(allocateExpense(100, ['c', 'b', 'a'], split), [{ uid: 'a', amountCents: 33 }, { uid: 'b', amountCents: 33 }, { uid: 'c', amountCents: 34 }]);
  assert.deepEqual(allocateExpense(1, ['b', 'a'], { mode: 'percentage', values: [{ uid: 'b', value: 5000 }, { uid: 'a', value: 5000 }] }), [{ uid: 'a', amountCents: 1 }, { uid: 'b', amountCents: 0 }]);
  for (const total of [1, 2, 99, 101, 1299, 100000000]) {
    const shares = allocateExpense(total, ['a', 'b', 'c'], split);
    assert.equal(shares.reduce((sum, s) => sum + s.amountCents, 0), total);
    assert.ok(shares.every(s => Number.isSafeInteger(s.amountCents) && s.amountCents >= 0));
    assert.deepEqual(allocateExpense(total, ['c', 'b', 'a'], split), shares);
  }
});

test('expense allocation: rejects ambiguous participants and invalid percentage or exact inputs', () => {
  for (const total of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => allocateExpense(total, ['a']));
  for (const ids of [[], ['a', 'a']]) assert.throws(() => allocateExpense(100, ids));
  const invalid = [
    { mode: 'other' }, { mode: 'exact' }, { mode: 'exact', values: [] },
    { mode: 'exact', values: [{ uid: 'a', value: 50 }, { uid: 'a', value: 50 }] },
    { mode: 'exact', values: [{ uid: 'a', value: 50 }, { uid: 'outsider', value: 50 }] },
    { mode: 'exact', values: [{ uid: 'a', value: -1 }, { uid: 'b', value: 101 }] },
    { mode: 'exact', values: [{ uid: 'a', value: 0.5 }, { uid: 'b', value: 99.5 }] },
    { mode: 'percentage', values: [{ uid: 'a', value: 5000 }, { uid: 'b', value: 4999 }] },
    { mode: 'percentage', values: [{ uid: 'a', value: 5000 }, { uid: 'b', value: 5001 }] },
  ];
  for (const split of invalid) assert.throws(() => allocateExpense(100, ['a', 'b'], split as ExpenseSplit));
});
