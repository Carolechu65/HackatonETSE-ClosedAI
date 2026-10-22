import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../persistence/db.ts';
import { authenticate } from '../auth/service.ts';
import { DomainError } from '../../../src/domain/errors.ts';
import { FixedWindowLimiter } from '../lib/rateLimit.ts';
import { CalendarService, type EventInput } from './service.ts';
import type { CalendarConfig } from './config.ts';
const COOKIE = '__Secure-alarmat-google';
const cookie = (value: string, age: number) => `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
function text(value: unknown, max=4096): string { if(typeof value!=='string'||!value||value.length>max) throw new DomainError('INVALID_ARGUMENT','Parámetro de calendario no válido.'); return value; }
function body(value:unknown):Record<string,unknown> { if(!value||typeof value!=='object'||Array.isArray(value)) throw new DomainError('INVALID_ARGUMENT','Datos de calendario no válidos.'); return value as Record<string,unknown>; }
const escape = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(message:string,content='') { return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Calendar · alarmaT</title><body style="background:#efe2c4;color:#3b2a1a;font-family:monospace;max-width:620px;margin:10vh auto;padding:24px"><h1>Tu calendario</h1><p>${escape(message)}</p>${content}</body></html>`; }
export function calendarRoutes(app:FastifyInstance,db:Db,config:CalendarConfig|null,fetcher?:typeof fetch) {
  const service=new CalendarService(db,config,fetcher); const limiter=new FixedWindowLimiter(60,60_000);
  const actor=(request:FastifyRequest)=>authenticate(db,request.headers.authorization);
  app.get('/v1/calendar/google/status',async r=>service.status(actor(r).uid));
  app.post('/v1/calendar/google/connect',async r=>{const a=actor(r);limiter.check(a.uid);return {url:service.connect(a.uid,a.sessionId)};});
  app.get('/v1/calendar/google/start',async(r,reply)=>{limiter.check(r.ip); const ticket=text((r.query as Record<string,unknown>).ticket,128); const result=service.start(ticket); reply.header('set-cookie',cookie(result.browser,600));reply.header('referrer-policy','no-referrer');return reply.redirect(result.url);});
  app.get('/v1/calendar/google/callback',async(r,reply)=>{
    reply.header('cache-control','no-store').header('referrer-policy','no-referrer').header('x-frame-options','DENY');
    const query=r.query as Record<string,unknown>; const browser=r.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)??'';
    try {
      const completion=await service.callback(text(query.state,128),browser,typeof query.code==='string'?text(query.code):undefined,!!query.error);
      const origin=new URL(config!.appUrl).origin;
      // The completion capability is delivered only to our originating app, never in a web URL.
      // A different logged-in account/session cannot redeem it (including a shared/phished start URL).
      const nonce=completion;
      reply.header('content-security-policy',`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
      const script=`<script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:'alarmat-calendar-complete',completion:${JSON.stringify(completion)}},${JSON.stringify(origin)});}</script>`;
      return reply.type('text/html').send(page('Google ha autorizado el acceso. Vuelve a la pestaña de alarmaT para terminar la conexión.',`<p><a href="alarmat://calendar?completion=${encodeURIComponent(completion)}">Volver a la app Android</a></p>${script}`));
    } catch { return reply.code(400).type('text/html').send(page('No se ha completado la conexión. Vuelve a alarmaT y pulsa Conectar Google Calendar de nuevo.')); }
    finally { reply.header('set-cookie',cookie('',0)); }
  });
  app.post('/v1/calendar/google/complete',async r=>{const a=actor(r);limiter.check(a.uid);return service.complete(a.uid,a.sessionId,text(body(r.body).completion,128));});
  app.post('/v1/calendar/google/disconnect',async r=>service.disconnect(actor(r).uid));
  app.get('/v1/calendar/google/calendars',async r=>{const a=actor(r);limiter.check(a.uid);const calendars=await service.calendars(a.uid);actor(r);return {calendars};});
  app.post('/v1/calendar/google/select',async r=>{const a=actor(r);limiter.check(a.uid);const result=await service.select(a.uid,text(body(r.body).calendarId,1024));actor(r);return result;});
  app.get('/v1/calendar/google/events',async r=>{const a=actor(r);limiter.check(a.uid);const q=r.query as Record<string,unknown>;const result=await service.events(a.uid,Number(q.from),Number(q.to),q.page===undefined?undefined:text(q.page,2048));actor(r);return result;});
  app.post('/v1/calendar/google/events',async r=>{const a=actor(r);limiter.check(a.uid);const result=await service.create(a.uid,body(r.body) as EventInput);actor(r);return {event:result};});
}
