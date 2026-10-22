import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTest,registerUser,createGroup,inviteAndJoin,createAlarm,auth,createAlarmBody,operationId } from './helpers.ts';
import { parseAlarmRequestDocument,parseRecipientDocument,parseScheduleDocument } from '../../src/domain/contracts/validate.ts';
import { readAlarmProjection } from '../src/compat/alarms.ts';
test('normalized projection uses canonical SQLite with private cursors and valid consent DTOs',async()=>{
 const ctx=await setupTest({fileDatabase:true});try{
 const a=await registerUser(ctx.app,'Emisor'),b=await registerUser(ctx.app,'Ana'),c=await registerUser(ctx.app,'C');const group=await createGroup(ctx.app,a);await inviteAndJoin(ctx.app,a,group,b);await inviteAndJoin(ctx.app,a,group,c);const requestId=await createAlarm(ctx.app,a,group,[b.uid]);
 const page=(await ctx.app.inject({url:'/v1/sync?projection=alarms',headers:auth(b.token)})).json();assert.equal(page.events.length,1);const record=page.events[0].alarm;parseAlarmRequestDocument(record.request);parseRecipientDocument(record.recipient);assert.equal(record.requestId,requestId);assert.equal(record.recipient.receivedVersion,1);
 assert.equal((await ctx.app.inject({url:'/v1/sync?projection=alarms',headers:auth(c.token)})).json().events.length,0);assert.equal((await ctx.app.inject({url:`/v1/sync?projection=alarms&cursor=${page.nextCursor}`,headers:auth(c.token)})).statusCode,400);
 const accept=await ctx.app.inject({method:'POST',url:'/v1/operations/respondToAlarm',headers:auth(b.token),payload:{schemaVersion:1,operationId:operationId(),groupId:group,entityId:requestId,expectedRequestVersion:1,expectedDecisionRevision:1,payload:{decision:'ACCEPTED',consentScope:'THIS_OCCURRENCE'}}});assert.equal(accept.statusCode,200,accept.body);
 await ctx.app.inject({method:'POST',url:'/v1/operations/withdrawAlarmRequest',headers:auth(a.token),payload:{schemaVersion:1,operationId:operationId(),groupId:group,entityId:requestId,expectedRequestVersion:1,payload:{reason:'terminada'}}});
 const withdrawn=(await ctx.app.inject({url:`/v1/groups/${group}/alarms`,headers:auth(a.token)})).json().alarms[0];parseRecipientDocument(withdrawn.recipient);assert.equal(withdrawn.recipient.decision,'NEEDS_REVIEW');assert.equal(withdrawn.recipient.consentScope,undefined);assert.equal(withdrawn.request.status,'WITHDRAWN');withdrawn.schedules.forEach(parseScheduleDocument);
 const device=(await ctx.app.inject({method:'POST',url:'/v1/devices',headers:auth(b.token),payload:{deviceId:'b-device',platform:'android'}})).json();assert.equal(device.deviceEpoch,1);const repeat=(await ctx.app.inject({method:'POST',url:'/v1/devices/primary',headers:auth(b.token),payload:{deviceId:'b-device'}})).json();assert.equal(repeat.deviceEpoch,1);
 assert.equal((await ctx.app.inject({url:`/v1/sync?projection=alarms&cursor=${page.nextCursor}`,headers:auth(b.token)})).json().events.at(-1).alarm.primaryDevice.deviceId,'b-device');
 assert.throws(()=>readAlarmProjection(ctx.db,b.uid,page.nextCursor,100,Date.now()+8*86400000),/caducó/);
 await ctx.app.inject({method:'DELETE',url:`/v1/groups/${group}/members/${b.uid}`,headers:auth(a.token)});const revoked=(await ctx.app.inject({url:`/v1/sync?projection=alarms&cursor=${page.nextCursor}`,headers:auth(b.token)})).json();assert.ok(revoked.events.every((e:{kind:string})=>e.kind==='revoke'));
 await inviteAndJoin(ctx.app,a,group,b);const rejoined=(await ctx.app.inject({url:`/v1/sync?projection=alarms&cursor=${revoked.nextCursor}`,headers:auth(b.token)})).json();assert.ok(rejoined.events.some((e:{kind:string})=>e.kind==='upsert'));
 }finally{await ctx.close();}
});
test('task idempotency/version checks and linked withdrawal share the canonical transaction',async()=>{
 const ctx=await setupTest({fileDatabase:true});try{
 const a=await registerUser(ctx.app,'A'),b=await registerUser(ctx.app,'B'),outside=await registerUser(ctx.app,'C');const group=await createGroup(ctx.app,a);await inviteAndJoin(ctx.app,a,group,b);
 const payload={operationId:operationId(),title:'Limpiar cocina',assigneeUid:b.uid,activateAtEpochMs:null,dueAtEpochMs:null};const create=()=>ctx.app.inject({method:'POST',url:`/v1/groups/${group}/tasks`,headers:auth(a.token),payload});const [one,two]=await Promise.all([create(),create()]);assert.equal(one.statusCode,200,one.body);assert.deepEqual(one.json(),two.json());const task=one.json();
 const proposal=createAlarmBody({groupId:group,recipientUids:[b.uid]});(proposal.payload as Record<string,unknown>).taskId=task.id;const alarm=await ctx.app.inject({method:'POST',url:'/v1/operations/createAlarmRequest',headers:auth(a.token),payload:proposal});assert.equal(alarm.statusCode,200,alarm.body);
 const update={operationId:operationId(),status:'completed',expectedVersion:1};const finish=()=>ctx.app.inject({method:'POST',url:`/v1/groups/${group}/tasks/${task.id}`,headers:auth(b.token),payload:update});const done=await finish();assert.equal(done.statusCode,200,done.body);assert.equal(done.json().version,2);assert.deepEqual((await finish()).json(),done.json());assert.equal((ctx.db.prepare('SELECT status FROM alarm_requests WHERE id=?').get(alarm.json().result.requestId) as {status:string}).status,'WITHDRAWN');
 assert.equal((await ctx.app.inject({method:'GET',url:`/v1/groups/${group}/tasks`,headers:auth(outside.token)})).statusCode,404);
 const changed=await ctx.app.inject({method:'POST',url:`/v1/groups/${group}/tasks`,headers:auth(a.token),payload:{...payload,title:'Reused id'}});assert.equal(changed.statusCode,409);
 }finally{await ctx.close();}
});
