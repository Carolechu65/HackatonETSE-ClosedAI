import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTest,registerUser,createGroup,inviteAndJoin,auth } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { parseCreateAlarmRequest } from '../../src/domain/contracts/validate.ts';
test('OpenRouter real through canonical agent and normalized chat alias',{skip:process.env.RUN_LIVE_AGENT!=='true'},async()=>{
 const configured=loadConfig();assert.ok(configured.agent.apiKey,'Configure a private provider key');const ctx=await setupTest({config:{agent:configured.agent},fileDatabase:true});try{
 const a=await registerUser(ctx.app,'Emisor sintético'),b=await registerUser(ctx.app,'Ana');const groupId=await createGroup(ctx.app,a,'Piso sintético');await inviteAndJoin(ctx.app,a,groupId,b);
 const first=await ctx.app.inject({method:'POST',url:'/v1/agent/draft',headers:auth(a.token),payload:{groupId,text:'Recuérdale a Ana sacar la basura cuando vuelva'}});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().status,'needs_clarification');
 const second=await ctx.app.inject({method:'POST',url:'/v1/agent/draft',headers:auth(a.token),payload:{groupId,text:'El 23 de octubre de 2027 a las 18:30 de Madrid, como NOTIFICATION. La destinataria es Ana.',conversationId:first.json().conversationId}});assert.equal(second.statusCode,200,second.body);assert.equal(second.json().status,'draft');assert.deepEqual(second.json().draft.recipientUids,[b.uid]);assert.equal(second.json().requiresRecipientConsent,true);parseCreateAlarmRequest({schemaVersion:1,operationId:'validate-live',groupId,payload:second.json().draft});assert.equal((ctx.db.prepare('SELECT count(*) AS n FROM alarm_requests').get() as {n:number}).n,0);
 }finally{await ctx.close();}
});
