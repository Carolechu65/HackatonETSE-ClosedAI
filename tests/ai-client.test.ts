import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiClient } from '../src/features/ai/client.ts';
const status = { available: true, providers: [{id:'openai', name:'OpenAI', models:['gpt-6-luna']}], connection:{provider:'openai',model:'gpt-6-luna',maskedKey:'••••a7c2',verifiedAt:1000} };
test('AI client exposes only masked metadata, never returned secrets', async () => {
 const client=createAiClient(async()=>({...status,apiKey:'private-root',connection:{...status.connection,apiKey:'private-key',secret_ciphertext:'private-ciphertext'}}));
 assert.deepEqual(await client.status(),status);
 assert.ok(!JSON.stringify(await client.status()).includes('private'));
});
test('AI client sends a key only on explicit test/save and requires a valid proof',async()=>{
 const calls:Array<{path:string;method?:string;body?:unknown}>=[];const token='a'.repeat(64);
 const client=createAiClient(async(path,method,body)=>{calls.push({path,method,body});return path.endsWith('/test')?{testToken:token,message:'Verificada'}:status;});
 const input={provider:'openai' as const,model:'gpt-6-luna',apiKey:'private-key'};
 await client.status();await client.test(input);await client.save(input,token);await client.remove();
 assert.deepEqual(calls.map(c=>c.path),['/v1/ai/connection','/v1/ai/connection/test','/v1/ai/connection/save','/v1/ai/connection/delete']);
 assert.equal(calls[0]?.body,undefined);assert.deepEqual(calls[1]?.body,input);assert.deepEqual(calls[2]?.body,{...input,testToken:token});assert.deepEqual(calls[3]?.body,{});
 for(const value of [{...status,connection:{...status.connection,maskedKey:'raw-secret'}},{...status,providers:[{id:'other',name:'other',models:[]}]},{...status,connection:{...status.connection,verifiedAt:NaN}}]) await assert.rejects(createAiClient(async()=>value).status());
 await assert.rejects(createAiClient(async()=>({testToken:'invalid',message:'ok'})).test(input));
});
