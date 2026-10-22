import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceClient,expenseBalance,parseEuros,type Expense } from '../src/features/expenses/client.ts';
const example:Expense={id:'expense-1',groupId:'group-1',title:'Compra',amountCents:100,paidByUid:'a',participantUids:['a','b','c'],settledUids:['a'],shares:[{uid:'a',amountCents:34},{uid:'b',amountCents:33},{uid:'c',amountCents:33}],version:1,createdAtEpochMs:1};
test('balances use exact participant shares, exclude payer and settled shares',()=>{
 assert.deepEqual(expenseBalance([example],'a'),{owed:66,owes:0});
 assert.deepEqual(expenseBalance([example],'b'),{owed:0,owes:33});
 assert.deepEqual(expenseBalance([{...example,settledUids:['a','b']}],'a'),{owed:33,owes:0});
 assert.deepEqual(expenseBalance([example],'outsider'),{owed:0,owes:0});
});
test('EUR parser preserves cents and rejects fractional cents and nondecimal input',()=>{
 assert.equal(parseEuros('12,50'),1250);assert.equal(parseEuros('0.29'),29);assert.equal(parseEuros('12.5'),1250);assert.equal(parseEuros('1000000'),100000000);assert.equal(parseEuros('1000000.01'),null);
 for(const value of ['0','-2','1e3','1.234','NaN','12,',''])assert.equal(parseEuros(value),null);
});
test('finance client rejects cross-household and inconsistent shares',async()=>{
 const valid=createFinanceClient(async()=>({currency:'EUR',expenses:[example]}));assert.deepEqual(await valid.list('group-1'),[example]);
 for(const bad of [{...example,groupId:'other'},{...example,shares:[{uid:'a',amountCents:100}]},{...example,shares:example.shares.map(s=>({...s,amountCents:1}))},{...example,settledUids:['outside']}]){
  const client=createFinanceClient(async()=>({currency:'EUR',expenses:[bad]}));await assert.rejects(()=>client.list('group-1'));
 }
});
test('settle sends no impersonated actor and preserves caller operation identity/version',async()=>{
 let sent:unknown;const client=createFinanceClient(async(path,method,body)=>{sent={path,method,body};return {expense:example};});
 await client.settle('group-1','expense-1',{operationId:'same-retry',expectedVersion:1});
 assert.deepEqual(sent,{path:'/v1/groups/group-1/expenses/expense-1/settle',method:'POST',body:{operationId:'same-retry',expectedVersion:1}});
});

test('selected debtors may exclude payer and their complete balance and deadline survive the client',async()=>{
 const selected:Expense={...example,participantUids:['b','c'],settledUids:[],shares:[{uid:'b',amountCents:50},{uid:'c',amountCents:50}],dueDate:'2028-02-29'};
 let sent:unknown;const client=createFinanceClient(async(path,method,body)=>{sent={path,method,body};return {expense:selected};});
 const draft={operationId:'deadline-retry',title:'Compra',amountCents:100,participantUids:['b','c'],dueDate:'2028-02-29'};
 assert.deepEqual(await client.create('group-1',draft),selected);
 assert.deepEqual(sent,{path:'/v1/groups/group-1/expenses',method:'POST',body:draft});
 assert.deepEqual(expenseBalance([selected],'a'),{owed:100,owes:0});
 assert.deepEqual(expenseBalance([selected],'b'),{owed:0,owes:50});
 for(const dueDate of ['2026-02-30','2025-02-29','',null]){
  const invalid=createFinanceClient(async()=>({currency:'EUR',expenses:[{...selected,dueDate}]}));
  await assert.rejects(()=>invalid.list('group-1'));
 }
});
