import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECEIPT_BYTES, prepareReceipt, validateReceiptSize } from '../src/features/expenses/receiptFile.ts';
test('receipt file preparation keeps image previews and PDFs upload-only, normalizes names',()=>{
 const data=Buffer.from('receipt-file-data').toString('base64');
 assert.deepEqual(prepareReceipt('cena.jpg',data,'image/jpeg'),{filename:'cena.jpg',base64:data,preview:`data:image/jpeg;base64,${data}`});
 assert.deepEqual(prepareReceipt('cena.pdf',data,'application/pdf'),{filename:'cena.pdf',base64:data});
 assert.equal(prepareReceipt('../'+ 'a'.repeat(200)+'.png',data,'image/png').filename.length,144);
 assert.equal(prepareReceipt('ticket\nname.jpeg',data,'image/jpeg').filename,'ticket_name.jpg');
});
test('receipt validation rejects unsupported, malformed and oversized files before upload',()=>{
 validateReceiptSize(MAX_RECEIPT_BYTES);
 for(const size of [0,7,-1,Infinity,NaN,8.5,MAX_RECEIPT_BYTES+1])assert.throws(()=>validateReceiptSize(size));
 for(const value of ['','!!??','dGVzdA===','dGVz'])assert.throws(()=>prepareReceipt('ticket',value,'image/png'));
 assert.throws(()=>prepareReceipt('ticket',Buffer.from('receipt-file-data').toString('base64'),'text/html'));
 assert.throws(()=>prepareReceipt('ticket',Buffer.alloc(MAX_RECEIPT_BYTES+1).toString('base64'),'application/pdf'));
});
