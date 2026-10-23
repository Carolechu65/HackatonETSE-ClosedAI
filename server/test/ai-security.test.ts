import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiConnections, loadAiCredentialKey } from '../src/agents/connections.ts';
import { auth, createGroup, registerUser, setupTest, testConfig, type TestContext, type TestUser } from './helpers.ts';

const key = 'sk-independent-security-fixture-9999';
const input = { provider: 'deepseek', model: 'deepseek-flash', apiKey: key };
const config = () => ({ aiCredentialKey: randomBytes(32), agent: { ...testConfig().agent, provider: 'none' as const } });
const chat = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
const pass = () => chat({ ok: true });
async function ai(ctx: TestContext, user: TestUser, operation: string, payload: Record<string,unknown>) {
  return ctx.app.inject({ method:'POST', url:'/v1/ai/connection/'+operation, headers:auth(user.token), payload });
}
async function save(ctx: TestContext, user: TestUser) {
  const tested=await ai(ctx,user,'test',input);assert.equal(tested.statusCode,200,tested.body);
  const saved=await ai(ctx,user,'save',{...input,testToken:tested.json().testToken});assert.equal(saved.statusCode,200,saved.body);return saved;
}
function deferred() { let resolve!:()=>void; const promise=new Promise<void>(done=>{resolve=done;}); return {promise,resolve}; }

test('security: proof cannot move between two valid sessions of the same account',async()=>{
 const ctx=await setupTest({config:config(),aiFetch:async()=>pass()});
 try{
  const ana=await registerUser(ctx.app,'Ana');
  const login=await ctx.app.inject({method:'POST',url:'/v1/auth/login',payload:{email:ana.email,password:'correct horse battery staple'}});assert.equal(login.statusCode,200);
  const second={...ana,token:login.json().token as string};
  const tested=await ai(ctx,ana,'test',input);assert.equal(tested.statusCode,200);
  const proof={...input,testToken:tested.json().testToken};
  assert.equal((await ai(ctx,second,'save',proof)).statusCode,400);
  assert.equal((await ai(ctx,ana,'save',proof)).statusCode,200);
 }finally{await ctx.close();}
});

test('security: logout while probe is in flight denies proof and clears pending ticket',async()=>{
 const entered=deferred();const release=deferred();
 const ctx=await setupTest({config:config(),aiFetch:async()=>{entered.resolve();await release.promise;return pass();}});
 try{
  const ana=await registerUser(ctx.app,'Ana');const pending=ai(ctx,ana,'test',input);await entered.promise;
  const logout=await ctx.app.inject({method:'POST',url:'/v1/auth/logout',headers:auth(ana.token)});assert.equal(logout.statusCode,200);
  release.resolve();const result=await pending;assert.equal(result.statusCode,401);assert.ok(!result.body.includes('testToken'));assert.ok(!result.body.includes(key));
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM ai_connection_tests').get() as {n:number}).n,0);
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM ai_connections').get() as {n:number}).n,0);
 }finally{release.resolve();await ctx.close();}
});

test('security: concurrent probe is rejected without a second billable request or overwriting first proof',async()=>{
 const entered=deferred();const release=deferred();let calls=0;
 const ctx=await setupTest({config:config(),aiFetch:async()=>{calls++;entered.resolve();await release.promise;return pass();}});
 try{
  const ana=await registerUser(ctx.app,'Ana');const pending=ai(ctx,ana,'test',input);await entered.promise;
  assert.equal((await ai(ctx,ana,'test',{...input,apiKey:'sk-other-secret-0000'})).statusCode,429);assert.equal(calls,1);
  release.resolve();const first=await pending;assert.equal(first.statusCode,200);
  assert.equal((await ai(ctx,ana,'save',{...input,testToken:first.json().testToken})).statusCode,200);
 }finally{release.resolve();await ctx.close();}
});

test('security: stale proof cannot overwrite a connection replaced from another tab',async()=>{
 const ctx=await setupTest({config:config(),aiFetch:async()=>pass()});
 try{
  const ana=await registerUser(ctx.app,'Ana');await save(ctx,ana);
  const tested=await ai(ctx,ana,'test',{...input,apiKey:'sk-new-key-for-replacement'});assert.equal(tested.statusCode,200);
  // Represents a committed update from another worker/tab after this probe began.
  ctx.db.prepare('UPDATE ai_connections SET revision=? WHERE owner_uid=?').run('another-committed-revision',ana.uid);
  const result=await ai(ctx,ana,'save',{...input,apiKey:'sk-new-key-for-replacement',testToken:tested.json().testToken});assert.equal(result.statusCode,409);
  assert.equal((ctx.db.prepare('SELECT key_last4 FROM ai_connections WHERE owner_uid=?').get(ana.uid) as {key_last4:string}).key_last4,'9999');
 }finally{await ctx.close();}
});

test('security: authenticated encryption binds model/provider and resealing uses a fresh nonce',async()=>{
 const ctx=await setupTest({config:config(),aiFetch:async()=>pass()});
 try{
  const ana=await registerUser(ctx.app,'Ana');await save(ctx,ana);
  const read=()=>ctx.db.prepare('SELECT * FROM ai_connections WHERE owner_uid=?').get(ana.uid) as {secret_ciphertext:string;provider:string;model:string};
  const first=read();await save(ctx,ana);const second=read();assert.notEqual(first.secret_ciphertext,second.secret_ciphertext);
  const service=new AiConnections(ctx.db,ctx.config.aiCredentialKey);
  for(const patch of [{field:'model',value:'different-model'},{field:'provider',value:'openrouter'}]){
   ctx.db.prepare(`UPDATE ai_connections SET ${patch.field}=? WHERE owner_uid=?`).run(patch.value,ana.uid);
   assert.throws(()=>service.provider(ana.uid),/proveedor no está disponible/);
   ctx.db.prepare('UPDATE ai_connections SET provider=?,model=? WHERE owner_uid=?').run(second.provider,second.model,ana.uid);
  }
  ctx.db.prepare('UPDATE ai_connections SET secret_ciphertext=? WHERE owner_uid=?').run(second.secret_ciphertext.replace(/^v1/, 'v2'),ana.uid);
  assert.throws(()=>service.provider(ana.uid),/proveedor no está disponible/);
 }finally{await ctx.close();}
});

test('security: unavailable encryption key fails closed and never issues provider requests',async()=>{
 let calls=0;const ctx=await setupTest({config:{...config(),aiCredentialKey:null},aiFetch:async()=>{calls++;return pass();}});
 try{
  const ana=await registerUser(ctx.app,'Ana');const status=await ctx.app.inject({url:'/v1/ai/connection',headers:auth(ana.token)});
  assert.equal(status.json().available,false);assert.equal((await ai(ctx,ana,'test',input)).statusCode,503);assert.equal(calls,0);
  const file=join(ctx.dir,'master.key');writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600});assert.equal(loadAiCredentialKey(file)?.length,32);
  chmodSync(file,0o644);assert.throws(()=>loadAiCredentialKey(file),/permisos inseguros/);
  chmodSync(file,0o600);writeFileSync(file,'not-a-valid-key');assert.throws(()=>loadAiCredentialKey(file),/32 bytes/);
  assert.throws(()=>loadAiCredentialKey('relative.key'),/ruta absoluta/);
 }finally{await ctx.close();}
});

test('security: invalid key headers, arbitrary destinations and unauthenticated mutations never reach provider',async()=>{
 let calls=0;const ctx=await setupTest({config:config(),aiFetch:async()=>{calls++;return pass();}});
 try{
  const ana=await registerUser(ctx.app,'Ana');
  for(const patch of [{apiKey:'sk-fixture\r\nX-Test: bad'},{provider:'http://127.0.0.1'},{baseUrl:'https://attacker.example'},{owner_uid:ana.uid}]){
   const result=await ai(ctx,ana,'test',{...input,...patch});assert.equal(result.statusCode,400);assert.ok(!result.body.includes(key));
  }
  for(const operation of ['test','save','delete']) assert.equal((await ctx.app.inject({method:'POST',url:'/v1/ai/connection/'+operation,payload:input})).statusCode,401);
  assert.equal(calls,0);
 }finally{await ctx.close();}
});

test('security: parallel users send only their own credentials and cannot read another masked key',async()=>{
 const authorizations:string[]=[];const ctx=await setupTest({config:config(),aiFetch:async(_url,init)=>{authorizations.push((init!.headers as Record<string,string>).authorization!);return pass();}});
 try{
  const ana=await registerUser(ctx.app,'Ana');const bruno=await registerUser(ctx.app,'Bruno');
  const [pa,pb]=await Promise.all([ai(ctx,ana,'test',input),ai(ctx,bruno,'test',{...input,apiKey:'sk-bruno-test-only-7777'})]);
  assert.deepEqual(authorizations.sort(),[`Bearer ${key}`,'Bearer sk-bruno-test-only-7777'].sort());
  await ai(ctx,ana,'save',{...input,testToken:pa.json().testToken});await ai(ctx,bruno,'save',{...input,apiKey:'sk-bruno-test-only-7777',testToken:pb.json().testToken});
  const anaStatus=await ctx.app.inject({url:'/v1/ai/connection?owner_uid='+bruno.uid,headers:auth(ana.token)});assert.equal(anaStatus.json().connection.maskedKey,'••••9999');assert.ok(!anaStatus.body.includes('7777'));assert.ok(!anaStatus.body.includes(key));
 }finally{await ctx.close();}
});

test('security: logged-out assistant request cannot persist or expose a late generated draft',async()=>{
 const entered=deferred();const release=deferred();let probing=true;
 const ctx=await setupTest({config:config(),aiFetch:async()=>{if(probing)return pass();entered.resolve();await release.promise;return chat({type:'clarification',question:'¿A qué hora?',missingFields:['time']});}});
 try{
  const ana=await registerUser(ctx.app,'Ana');const groupId=await createGroup(ctx.app,ana);await save(ctx,ana);probing=false;
  const pending=(async()=>ctx.app.inject({method:'POST',url:'/v1/agent/draft',headers:auth(ana.token),payload:{groupId,text:'Recuérdame sacar la basura'}}))();await entered.promise;
  await ctx.app.inject({method:'POST',url:'/v1/auth/logout',headers:auth(ana.token)});release.resolve();const result=await pending;assert.equal(result.statusCode,401);assert.ok(!result.body.includes('¿A qué hora?'));
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM alarm_requests').get() as {n:number}).n,0);
 }finally{release.resolve();await ctx.close();}
});

test('security: failed storage setup releases per-user probe lock for a later retry',async()=>{
 const ctx=await setupTest({config:config(),aiFetch:async()=>pass()});
 try{
  const ana=await registerUser(ctx.app,'Ana');
  ctx.db.exec("CREATE TRIGGER simulate_failed_ai_ticket BEFORE INSERT ON ai_connection_tests BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;");
  assert.equal((await ai(ctx,ana,'test',input)).statusCode,503);
  ctx.db.exec('DROP TRIGGER simulate_failed_ai_ticket');
  assert.equal((await ai(ctx,ana,'test',input)).statusCode,200);
 }finally{await ctx.close();}
});
