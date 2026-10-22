import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app/buildApp.ts';
import { calendarConfig, type CalendarConfig } from '../src/calendar/config.ts';
import { CalendarService, digest } from '../src/calendar/service.ts';
import { auth, registerUser, setupTest } from './helpers.ts';
const config:CalendarConfig={clientId:'test-client',clientSecret:'test-secret',encryptionKey:'a'.repeat(64),redirectUri:'https://app.example.test/existing/callback',publicApiUrl:'https://app.example.test',appUrl:'https://app.example.test/alarmat/'};
function fakeGoogle() {
  const calls:Array<{url:string;body:any}>=[];const events=new Map<string,any>();let tokenStatus=200;let tokenError='';let expiry=3600;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);const body=init?.body instanceof URLSearchParams?Object.fromEntries(init.body):init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,body});
    let data:any;let status=200;
    if(url.includes('/token')){status=tokenStatus;data=status===200?{access_token:'google-private-access',refresh_token:'google-private-refresh',expires_in:expiry}:{error:tokenError};}
    else if(url.includes('calendarList'))data={items:[{id:'personal',summary:'Personal',primary:true,accessRole:'owner',timeZone:'Europe/Madrid'},{id:'readonly',summary:'Solo lectura',accessRole:'reader'}]};
    else if(init?.method==='POST'){if(events.has(body.id)){status=409;data={};}else{data={...body,htmlLink:'https://calendar.google.com/calendar/event?eid=synthetic'};events.set(body.id,data);}}
    else if(/\/events\//.test(url))data=events.get(url.split('/').at(-1)!);
    else data={items:[{id:'all-day',summary:'Fiesta',start:{date:'2030-01-16'},end:{date:'2030-01-17'}},{id:'timed',summary:'Reunión',start:{dateTime:'2030-01-16T18:00:00+01:00'},end:{dateTime:'2030-01-16T18:30:00+01:00'}}],timeZone:'Europe/Madrid',nextPageToken:'next'};
    return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  };
  return {fetcher,calls,events,failRefresh(){tokenStatus=400;tokenError='invalid_grant';},expireSoon(){expiry=1;}};
}
async function context(){const ctx=await setupTest({config:{calendar:config}});const google=fakeGoogle();const a=await registerUser(ctx.app,'A');const b=await registerUser(ctx.app,'B');const service=new CalendarService(ctx.db,config,google.fetcher);return {...ctx,google,a,b,service};}
async function connect(ctx:Awaited<ReturnType<typeof context>>){const url=ctx.service.connect(ctx.a.uid,digest(ctx.a.token));const state=new URL(url).searchParams.get('ticket')!;const start=ctx.service.start(state);const completion=await ctx.service.callback(state,start.browser,'google-code',false);return {state,start,completion};}

test('calendar: no configuration is explicit; malformed or cross-origin config fails',()=>{
  assert.equal(calendarConfig({}),null);assert.throws(()=>calendarConfig({GOOGLE_CLIENT_ID:'only-id'}));
  assert.throws(()=>calendarConfig({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',CALENDAR_ENCRYPTION_KEY:'b'.repeat(64),GOOGLE_REDIRECT_URI:'https://other.test/callback',CALENDAR_PUBLIC_API_URL:config.publicApiUrl,CALENDAR_APP_URL:config.appUrl}));
});
test('calendar: OAuth uses PKCE, encrypted tokens and final confirmation by the same account/session',async()=>{const ctx=await context();try{
  const {state,start,completion}=await connect(ctx);const google=new URL(start.url);assert.equal(google.origin,'https://accounts.google.com');assert.equal(google.searchParams.get('code_challenge_method'),'S256');assert.equal(google.searchParams.get('redirect_uri'),config.redirectUri);
  assert.equal(ctx.service.status(ctx.a.uid).connected,false);assert.throws(()=>ctx.service.complete(ctx.b.uid,digest(ctx.b.token),completion));
  assert.equal(ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion).connected,true);assert.equal(ctx.service.status(ctx.b.uid).connected,false);assert.throws(()=>ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion));
  const stored=JSON.stringify(ctx.db.prepare('SELECT * FROM calendar_connections').all());assert.ok(!stored.includes('google-private'));assert.ok(!stored.includes(ctx.a.token));
  await assert.rejects(()=>ctx.service.callback(state,start.browser,'replay',false));
}finally{await ctx.close();}});
test('calendar: wrong browser, reused ticket, revoked session and denied consent never connect',async()=>{const ctx=await context();try{
  const state=new URL(ctx.service.connect(ctx.a.uid,digest(ctx.a.token))).searchParams.get('ticket')!;const start=ctx.service.start(state);assert.throws(()=>ctx.service.start(state));
  await assert.rejects(()=>ctx.service.callback(state,'wrong-browser','code',false));
  await assert.rejects(()=>ctx.service.callback(state,start.browser,undefined,true));assert.equal(ctx.google.calls.length,0);
  const second=new URL(ctx.service.connect(ctx.a.uid,digest(ctx.a.token))).searchParams.get('ticket')!;
  ctx.db.prepare('UPDATE sessions SET revoked_at_epoch_ms=? WHERE id=?').run(Date.now(),digest(ctx.a.token));assert.throws(()=>ctx.service.start(second));
}finally{await ctx.close();}});
test('calendar: expired state and disconnected pending completion cannot reconnect',async()=>{const ctx=await context();try{
  const {completion}=await connect(ctx);ctx.service.disconnect(ctx.a.uid);assert.throws(()=>ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion));
  const state=new URL(ctx.service.connect(ctx.a.uid,digest(ctx.a.token))).searchParams.get('ticket')!;ctx.db.prepare('UPDATE calendar_oauth SET expires_at=1').run();assert.throws(()=>ctx.service.start(state));
}finally{await ctx.close();}});
test('calendar: selection is authorized, all-day dates preserved, ranges and pagination bounded',async()=>{const ctx=await context();try{
  const {completion}=await connect(ctx);ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion);await ctx.service.select(ctx.a.uid,'personal');await assert.rejects(()=>ctx.service.select(ctx.a.uid,'someone-else'));
  const events=await ctx.service.events(ctx.a.uid,Date.UTC(2030,0,15),Date.UTC(2030,0,22));assert.equal(events.events[0]!.start,'2030-01-16');assert.equal(events.events[0]!.allDay,true);assert.equal(events.nextPageToken,'next');assert.equal(events.calendarId,'personal');
  await assert.rejects(()=>ctx.service.events(ctx.b.uid,1,100));await assert.rejects(()=>ctx.service.events(ctx.a.uid,1,95*86400000));
  await assert.rejects(()=>ctx.service.events(ctx.a.uid,Number.MAX_SAFE_INTEGER-1000,Number.MAX_SAFE_INTEGER),/intervalo/);
}finally{await ctx.close();}});
test('calendar: creation is idempotent, conflict is rejected and no attendees or automatic reminders are added',async()=>{const ctx=await context();try{
  const {completion}=await connect(ctx);ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion);
  const draft={operationId:'calendar-op-1234',title:'Plan',startEpochMs:Date.UTC(2030,0,16,17),endEpochMs:Date.UTC(2030,0,16,18),timeZone:'Europe/Madrid'};
  const first=await ctx.service.create(ctx.a.uid,draft);const second=await ctx.service.create(ctx.a.uid,draft);assert.equal(first.id,second.id);assert.equal(ctx.google.events.size,1);
  const event=ctx.google.events.get(first.id);assert.equal(event.attendees,undefined);assert.deepEqual(event.reminders,{useDefault:false});
  await assert.rejects(()=>ctx.service.create(ctx.a.uid,{...draft,title:'Changed'}));await ctx.service.select(ctx.a.uid,'readonly');await assert.rejects(()=>ctx.service.create(ctx.a.uid,{...draft,operationId:'calendar-readonly'}));
}finally{await ctx.close();}});
test('calendar: failed refresh becomes reconnect-required; provider errors do not expose secrets',async()=>{const ctx=await context();try{
  ctx.google.expireSoon();const {completion}=await connect(ctx);ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion);ctx.google.failRefresh();await assert.rejects(()=>ctx.service.calendars(ctx.a.uid),/Vuelve a conectar/);assert.equal(ctx.service.status(ctx.a.uid).reconnectRequired,true);
}finally{await ctx.close();}});
test('calendar: disconnect while token refresh is in flight cannot resurrect access',async()=>{const ctx=await context();try{
  ctx.google.expireSoon();const {completion}=await connect(ctx);ctx.service.complete(ctx.a.uid,digest(ctx.a.token),completion);
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const fetcher:typeof fetch=async(url,init)=>{await gate;return ctx.google.fetcher(url,init);};const service=new CalendarService(ctx.db,config,fetcher);
  const reading=service.calendars(ctx.a.uid);service.disconnect(ctx.a.uid);release();await assert.rejects(()=>reading);assert.equal(service.status(ctx.a.uid).connected,false);
}finally{await ctx.close();}});
test('calendar HTTP: auth, cookie-bound callback and two-step completion work without exposing tokens',async()=>{const ctx=await context();const app=buildApp({config:ctx.config,db:ctx.db,logger:false,calendarFetch:ctx.google.fetcher});try{
  assert.equal((await app.inject({url:'/v1/calendar/google/status'})).statusCode,401);
  const started=await app.inject({method:'POST',url:'/v1/calendar/google/connect',headers:auth(ctx.a.token),payload:{}});assert.equal(started.statusCode,200);
  const startUrl=new URL(started.json().url);const state=startUrl.searchParams.get('ticket')!;
  const start=await app.inject({url:startUrl.pathname+startUrl.search});assert.equal(start.statusCode,302);assert.match(String(start.headers['set-cookie']),/HttpOnly; Secure; SameSite=Lax/);
  const callback=await app.inject({url:`/v1/calendar/google/callback?state=${state}&code=synthetic`,headers:{cookie:String(start.headers['set-cookie']).split(';')[0]!}});assert.equal(callback.statusCode,200);assert.ok(!callback.body.includes('google-private'));
  const completion=/completion:"([A-Za-z0-9_-]+)"/.exec(callback.body)![1];
  assert.equal((await app.inject({method:'POST',url:'/v1/calendar/google/complete',headers:auth(ctx.b.token),payload:{completion}})).statusCode,400);
  const result=await app.inject({method:'POST',url:'/v1/calendar/google/complete',headers:auth(ctx.a.token),payload:{completion}});assert.equal(result.json().connected,true);
  assert.equal((await app.inject({method:'POST',url:'/v1/calendar/google/disconnect',headers:auth(ctx.a.token),payload:{}})).statusCode,200);
}finally{await app.close();await ctx.close();}});
