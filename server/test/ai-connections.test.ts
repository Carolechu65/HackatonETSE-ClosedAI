import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { auth, createGroup, inviteAndJoin, registerUser, setupTest, testConfig, type TestContext, type TestUser } from './helpers.ts';
import { PersonalAiProvider, endpointFor } from '../src/agents/personalProvider.ts';
import { AiConnections } from '../src/agents/connections.ts';
import { authenticate } from '../src/auth/service.ts';

const input = { provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-ana-secret-12345678' };
const chat = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } });
const config = () => ({ aiCredentialKey: randomBytes(32), agent: { ...testConfig().agent, provider: 'openai' as const, apiKey: 'global-key-must-never-be-used', baseUrl: 'https://global.invalid', model: 'global-model' } });
async function request(ctx: TestContext, user: TestUser, path: string, payload?: unknown) { return ctx.app.inject({ method: payload === undefined ? 'GET' : 'POST', url: '/v1/ai/connection'+path, headers: auth(user.token), ...(payload === undefined ? {} : { payload: payload as Record<string,unknown> }) }); }
async function connect(ctx: TestContext, user: TestUser, value = input) { const probe = await request(ctx,user,'/test',value); assert.equal(probe.statusCode,200,probe.body); const save = await request(ctx,user,'/save',{...value,testToken:probe.json().testToken}); assert.equal(save.statusCode,200,save.body); return probe.json().testToken as string; }

test('credenciales por usuario: prueba, cifrado, aislamiento, uso sin clave global, borrado y consentimiento', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const ctx = await setupTest({ config: config(), aiFetch: async (url, init) => { calls.push({url:String(url),init:init!}); const b=JSON.parse(String(init!.body)); return chat(b.messages[0].content.includes('Return only') ? {ok:true} : {type:'clarification',question:'¿A qué hora?',missingFields:['time']}); } });
  try {
    const ana=await registerUser(ctx.app,'Ana');const bruno=await registerUser(ctx.app,'Bruno');const groupId=await createGroup(ctx.app,ana);await inviteAndJoin(ctx.app,ana,groupId,bruno);
    assert.equal((await ctx.app.inject({url:'/v1/ai/connection'})).statusCode,401);
    const noKey=await ctx.app.inject({method:'POST',url:'/v1/agent/draft',headers:auth(ana.token),payload:{groupId,text:'Sacar la basura'}});
    assert.equal(noKey.statusCode,503);assert.equal(calls.length,0);
    const token=await connect(ctx,ana);
    const row=ctx.db.prepare('SELECT * FROM ai_connections WHERE owner_uid=?').get(ana.uid) as Record<string,string>;
    assert.ok(!JSON.stringify(row).includes(input.apiKey));assert.match(row.secret_ciphertext!,/^v1\./);
    assert.equal((await request(ctx,ana,'')).json().connection.maskedKey,'••••5678');
    assert.equal((await request(ctx,bruno,'')).json().connection,null);
    assert.equal((await request(ctx,bruno,'/save',{...input,testToken:token})).statusCode,400);
    assert.equal((await request(ctx,ana,'/save',{...input,testToken:token})).statusCode,400);
    assert.equal((await request(ctx,ana,'/test',{...input,baseUrl:'http://127.0.0.1'})).statusCode,400);
    const draft=await ctx.app.inject({method:'POST',url:'/v1/agent/draft',headers:auth(ana.token),payload:{groupId,text:'Recuérdale a Bruno sacar la basura'}});
    assert.equal(draft.statusCode,200,draft.body);assert.equal(draft.json().status,'needs_clarification');
    assert.equal(calls.length,2);for(const call of calls){assert.equal(call.url,'https://api.deepseek.com/chat/completions');assert.equal((call.init.headers as Record<string,string>).authorization,`Bearer ${input.apiKey}`);assert.equal(call.init.redirect,'error');}
    assert.ok(!String(calls[0]!.init.body).includes(groupId));assert.ok(!String(calls[1]!.init.body).includes(input.apiKey));
    const other=await ctx.app.inject({method:'POST',url:'/v1/agent/propose',headers:auth(bruno.token),payload:{groupId,text:'Recuérdame limpiar'}});assert.equal(other.statusCode,503);assert.equal(calls.length,2);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM alarm_requests').get() as {n:number}).n,0);
    assert.equal((await request(ctx,bruno,'/delete',{owner_uid:ana.uid})).statusCode,400);
    await request(ctx,bruno,'/delete',{});assert.ok((await request(ctx,ana,'')).json().connection);
    await request(ctx,ana,'/delete',{});assert.equal((await request(ctx,ana,'')).json().connection,null);
  } finally {await ctx.close();}
});

test('una prueba no autoriza otra clave/modelo, caduca y no puede revivir una conexión eliminada',async()=>{
 const ctx=await setupTest({config:config(),aiFetch:async()=>chat({ok:true})});
 try {const ana=await registerUser(ctx.app,'Ana');const probe=await request(ctx,ana,'/test',input);const token=probe.json().testToken;
 for(const patch of [{apiKey:'sk-another-secret-key'}, {model:'different'}, {provider:'openai'}]) assert.equal((await request(ctx,ana,'/save',{...input,...patch,testToken:token})).statusCode,400);
 ctx.db.prepare('UPDATE ai_connection_tests SET expires_at_epoch_ms=0').run();assert.equal((await request(ctx,ana,'/save',{...input,testToken:token})).statusCode,400);
 const newer=await request(ctx,ana,'/test',input);await request(ctx,ana,'/delete',{});assert.equal((await request(ctx,ana,'/save',{...input,testToken:newer.json().testToken})).statusCode,400);
 }finally{await ctx.close();}
});

test('fallo del proveedor no filtra secretos ni destruye la conexión anterior; AEAD impide intercambiar claves',async()=>{
 let fail=false;const ctx=await setupTest({config:config(),aiFetch:async()=>fail?new Response(input.apiKey,{status:401}):chat({ok:true})});
 try{const ana=await registerUser(ctx.app,'Ana');const bruno=await registerUser(ctx.app,'Bruno');await connect(ctx,ana);await connect(ctx,bruno,{...input,apiKey:'sk-bruno-private-8888'});
 const service=new AiConnections(ctx.db,ctx.config.aiCredentialKey);const anaRow=ctx.db.prepare('SELECT secret_ciphertext FROM ai_connections WHERE owner_uid=?').get(ana.uid) as {secret_ciphertext:string};
 ctx.db.prepare('UPDATE ai_connections SET secret_ciphertext=? WHERE owner_uid=?').run(anaRow.secret_ciphertext,bruno.uid);assert.throws(()=>service.provider(bruno.uid),/proveedor no está disponible/);
 fail=true;const failure=await request(ctx,ana,'/test',input);assert.equal(failure.statusCode,503);assert.ok(!failure.body.includes(input.apiKey));assert.ok((await request(ctx,ana,'')).json().connection);
 }finally{await ctx.close();}
});

test('logout y borrado durante una prueba bloquean guardados tardíos',async()=>{
 let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>{entered=r});const blocked=new Promise<void>(r=>{release=r});
 const ctx=await setupTest({config:config(),aiFetch:async()=>{entered();await blocked;return chat({ok:true});}});
 try{const ana=await registerUser(ctx.app,'Ana');const pending=request(ctx,ana,'/test',input);await started;await request(ctx,ana,'/delete',{});release();assert.equal((await pending).statusCode,409);assert.equal((await request(ctx,ana,'')).json().connection,null);
 }finally{release();await ctx.close();}
 const ctx2=await setupTest({config:config(),aiFetch:async()=>chat({ok:true})});
 try{const ana=await registerUser(ctx2.app,'Ana');const ticket=await request(ctx2,ana,'/test',input);await ctx2.app.inject({method:'POST',url:'/v1/auth/logout',headers:auth(ana.token)});assert.equal((await request(ctx2,ana,'/save',{...input,testToken:ticket.json().testToken})).statusCode,401);}finally{await ctx2.close();}
});

test('borrado durante una consulta descarta la respuesta en vuelo',async()=>{
 const ctx=await setupTest({config:config(),aiFetch:async()=>chat({ok:true})});
 try{const ana=await registerUser(ctx.app,'Ana');await connect(ctx,ana);let release!:()=>void;const block=new Promise<void>(r=>release=r);const service=new AiConnections(ctx.db,ctx.config.aiCredentialKey,1000,async()=>{await block;return chat({ok:true});});
 const delegate=service.provider(ana.uid);const pending=delegate.next({} as never);service.remove(ana.uid);release();await assert.rejects(pending,/proveedor no está disponible/);
 }finally{await ctx.close();}
});

test('formatos Responses y Chat Completions, errores, límites y ausencia de redirecciones',async()=>{
 for(const provider of ['openai','opencode','openrouter','deepseek'] as const){for(const model of provider==='opencode'?['gpt-6-luna','deepseek-v4.1-flash']:[provider==='openai'?'gpt-6-luna':input.model]){
 const value={...input,provider,model};const endpoint=endpointFor(value);let called=false;
 const p=new PersonalAiProvider(value,1000,async(url,init)=>{called=true;assert.equal(String(url),endpoint.url);assert.equal(init?.redirect,'error');const b=JSON.parse(String(init?.body));assert.equal(b.model,model);assert.ok(!('temperature' in b));
 if(endpoint.responses){assert.equal(b.store,false);assert.equal(b.max_output_tokens,512);return new Response(JSON.stringify({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}));}return chat({ok:true});});await p.test();assert.ok(called);
 }}
 for(const response of [new Response('secret',{status:401}),new Response('secret',{status:402}),new Response('',{status:429}),new Response('',{status:302,headers:{location:'http://127.0.0.1/'}}),new Response('x'.repeat(140000)),new Response('{}')]){
 const p=new PersonalAiProvider({...input,provider:'deepseek'},1000,async()=>response);await assert.rejects(p.test(),e=>e instanceof Error && !e.message.includes('secret') && e.message.includes('Revisa tu conexión'));
 }
});
