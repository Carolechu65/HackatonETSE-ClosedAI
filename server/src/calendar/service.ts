import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Db } from '../persistence/db.ts';
import { DomainError } from '../../../src/domain/errors.ts';
import type { CalendarConfig } from './config.ts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const invalid = () => new DomainError('INVALID_ARGUMENT', 'La conexión de Google ha caducado o no es válida. Vuelve a conectar.');
const unavailable = () => new DomainError('TEMPORARY_UNAVAILABLE', 'Google Calendar no está disponible. Vuelve a intentarlo.');
const reconnect = () => new DomainError('FORBIDDEN', 'Vuelve a conectar tu cuenta de Google Calendar.');
type Connection = { user_id: string; generation: string; tokens: string | null; calendar_id: string; invalid: number };
type Attempt = { state_hash: string; user_id: string; session_hash: string; generation: string; verifier: string; browser_hash: string | null; expires_at: number };
type Tokens = { access_token: string; refresh_token: string; expiry: number };
type Json = Record<string, any>;
export type GoogleCalendar = { id: string; summary: string; primary: boolean; writable: boolean; timeZone: string };
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; timeZone: string; url: string | null };
export type EventInput = { operationId: string; title: string; startEpochMs: number; endEpochMs: number; timeZone: string };
export class CalendarService {
  private readonly refreshes = new Map<string, Promise<Tokens>>();
  constructor(private readonly db: Db, readonly config: CalendarConfig | null, private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
  private configured(): CalendarConfig { if (!this.config) throw unavailable(); return this.config; }
  private seal(value: unknown, context: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.configured().encryptionKey, 'hex'), iv);
    cipher.setAAD(Buffer.from(context)); const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  }
  private open<T>(value: string, context: string): T {
    try { const bytes = Buffer.from(value, 'base64'); const cipher = createDecipheriv('aes-256-gcm', Buffer.from(this.configured().encryptionKey, 'hex'), bytes.subarray(0,12)); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(bytes.subarray(12,28)); return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()) as T; } catch { throw reconnect(); }
  }
  private connection(uid: string): Connection | undefined { return this.db.prepare('SELECT * FROM calendar_connections WHERE user_id=?').get(uid) as Connection | undefined; }
  status(uid: string) { this.db.prepare('DELETE FROM calendar_oauth_results WHERE expires_at<=?').run(this.now()); this.db.prepare('DELETE FROM calendar_oauth WHERE expires_at<=?').run(this.now()); const row = this.connection(uid); return { configured: !!this.config, connected: !!this.config && !!row?.tokens && !row.invalid, reconnectRequired: !!row?.invalid, calendarId: row?.calendar_id ?? 'primary' }; }
  private sessionActive(attempt: Attempt): boolean {
    return !!this.db.prepare('SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at_epoch_ms IS NULL AND expires_at_epoch_ms>?').get(attempt.session_hash, attempt.user_id, this.now());
  }
  connect(uid: string, sessionHash: string): string {
    const config = this.configured(); const state = `alarmat_${random()}`; const generation = random();
    const verifier = random();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM calendar_oauth WHERE expires_at<=? OR user_id=?').run(this.now(), uid);
      this.db.prepare('INSERT INTO calendar_connections(user_id,generation,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,updated_at=excluded.updated_at').run(uid, generation, this.now());
      this.db.prepare('INSERT INTO calendar_oauth VALUES (?,?,?,?,?,?,?)').run(digest(state), uid, sessionHash, generation, this.seal(verifier, uid), null, this.now()+600_000);
    })();
    return `${config.publicApiUrl}/v1/calendar/google/start?ticket=${encodeURIComponent(state)}`;
  }
  start(state: string) {
    const config = this.configured(); const attempt = this.db.prepare('SELECT * FROM calendar_oauth WHERE state_hash=?').get(digest(state)) as Attempt | undefined;
    if (!attempt || attempt.browser_hash || attempt.expires_at <= this.now() || !this.sessionActive(attempt)) throw invalid();
    const browser = random(); this.db.prepare('UPDATE calendar_oauth SET browser_hash=? WHERE state_hash=?').run(digest(browser), digest(state));
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events', state, code_challenge: createHash('sha256').update(this.open<string>(attempt.verifier, attempt.user_id)).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { url: url.toString(), browser };
  }
  async callback(state: string, browser: string, code: string | undefined, denied: boolean): Promise<string> {
    const config = this.configured();
    const attempt = this.db.prepare('SELECT * FROM calendar_oauth WHERE state_hash=?').get(digest(state)) as Attempt | undefined;
    if (!attempt || !attempt.browser_hash || attempt.browser_hash !== digest(browser) || attempt.expires_at <= this.now() || !this.sessionActive(attempt)) throw invalid();
    this.db.prepare('DELETE FROM calendar_oauth WHERE state_hash=?').run(digest(state));
    if (denied || !code) throw new DomainError('FORBIDDEN', 'No has autorizado la conexión. Tu calendario sigue sin cambios.');
    const { data, status } = await this.json('https://oauth2.googleapis.com/token', { method:'POST', body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type:'authorization_code', redirect_uri:config.redirectUri, code_verifier: this.open<string>(attempt.verifier, attempt.user_id) }) });
    if (status !== 200) throw unavailable();
    const tokens = this.parseTokens(data);
    if (!this.sessionActive(attempt)) throw invalid();
    if (this.connection(attempt.user_id)?.generation !== attempt.generation) throw invalid();
    const completion = random();
    this.db.prepare('DELETE FROM calendar_oauth_results WHERE expires_at<=? OR user_id=?').run(this.now(), attempt.user_id);
    this.db.prepare('INSERT INTO calendar_oauth_results VALUES (?,?,?,?,?,?)').run(digest(completion), attempt.user_id, attempt.session_hash, attempt.generation, this.seal(tokens, attempt.user_id), this.now()+300_000);
    return completion;
  }
  complete(uid: string, sessionHash: string, completion: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM calendar_oauth_results WHERE completion_hash=? AND user_id=? AND session_hash=? AND expires_at>?').get(digest(completion), uid, sessionHash, this.now()) as {tokens:string;generation:string}|undefined;
      if (!row) throw invalid();
      const result = this.db.prepare('UPDATE calendar_connections SET tokens=?,invalid=0,updated_at=? WHERE user_id=? AND generation=?').run(row.tokens,this.now(),uid,row.generation);
      this.db.prepare('DELETE FROM calendar_oauth_results WHERE completion_hash=?').run(digest(completion));
      if (!result.changes) throw invalid(); return this.status(uid);
    })();
  }
  private parseTokens(data: Json, previous?: Tokens): Tokens {
    if (typeof data.access_token !== 'string' || !data.access_token || typeof (data.refresh_token ?? previous?.refresh_token) !== 'string' || !(data.refresh_token ?? previous?.refresh_token) || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw unavailable();
    if (typeof data.scope === 'string' && !data.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.readonly')) throw new DomainError('FORBIDDEN', 'Google no concedió acceso al calendario. Vuelve a conectar y concede el permiso.');
    return { access_token: data.access_token, refresh_token: data.refresh_token ?? previous!.refresh_token, expiry: this.now()+data.expires_in*1000 };
  }
  private async json(url: string, init: RequestInit = {}): Promise<{status:number; data:Json}> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal, redirect:'error' });
      if (Number(response.headers.get('content-length')) > 2_000_000) throw unavailable();
      const reader = response.body?.getReader(); let text = ''; let size = 0;
      if (reader) { const decoder = new TextDecoder(); try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2_000_000) throw unavailable(); text += decoder.decode(chunk.value,{stream:true}); } text+=decoder.decode(); } finally { void reader.cancel().catch(()=>{}); } }
      else text = await response.text();
      if (text.length > 2_000_000) throw unavailable();
      const data = text ? JSON.parse(text) : {}; if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
      return { status:response.status, data };
    } catch { throw unavailable(); } finally { clearTimeout(timer); }
  }
  private assertCurrent(row: Connection) { const current = this.connection(row.user_id); if (!current?.tokens || current.generation !== row.generation || current.invalid) throw reconnect(); }
  private async token(row: Connection): Promise<Tokens> {
    if (!row.tokens || row.invalid) throw reconnect();
    const tokens = this.open<Tokens>(row.tokens, row.user_id); if (tokens.expiry > this.now()+60_000) return tokens;
    const key = `${row.user_id}:${row.generation}`; const previous = this.refreshes.get(key); if (previous) return previous;
    const work = (async () => {
      const config = this.configured(); const {status,data} = await this.json('https://oauth2.googleapis.com/token', {method:'POST',body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:tokens.refresh_token,grant_type:'refresh_token'})});
      if (status === 400 && data.error === 'invalid_grant') { this.db.prepare('UPDATE calendar_connections SET invalid=1 WHERE user_id=? AND generation=?').run(row.user_id,row.generation); throw reconnect(); }
      if (status !== 200) throw unavailable(); const next = this.parseTokens(data,tokens); this.assertCurrent(row);
      this.db.prepare('UPDATE calendar_connections SET tokens=?,updated_at=? WHERE user_id=? AND generation=?').run(this.seal(next,row.user_id),this.now(),row.user_id,row.generation); return next;
    })(); this.refreshes.set(key,work); try { return await work; } finally { this.refreshes.delete(key); }
  }
  private async api(uid:string,path:string,init:RequestInit = {}) {
    const row = this.connection(uid); if (!row?.tokens || row.invalid) throw reconnect();
    const token = await this.token(row); this.assertCurrent(row);
    const result = await this.json(`https://www.googleapis.com/calendar/v3/${path}`,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token.access_token}`}});
    this.assertCurrent(row);
    if (result.status === 401) { this.db.prepare('UPDATE calendar_connections SET invalid=1 WHERE user_id=? AND generation=?').run(uid,row.generation); throw reconnect(); }
    if (result.status === 403) throw new DomainError('FORBIDDEN','Google no permite esta acción. Revisa los permisos del calendario.');
    if (result.status === 404) throw new DomainError('NOT_FOUND','El calendario o evento ya no está disponible.');
    if (result.status >= 500 || result.status === 429) throw unavailable(); return result;
  }
  async calendars(uid:string): Promise<GoogleCalendar[]> {
    const items: GoogleCalendar[]=[]; let page='';
    for (let i=0;i<10;i++) {
      const {status,data}=await this.api(uid,`users/me/calendarList?maxResults=250${page?`&pageToken=${encodeURIComponent(page)}`:''}`); if(status!==200 || !Array.isArray(data.items)) throw unavailable();
      for (const item of data.items) { if(typeof item.id!=='string') throw unavailable(); items.push({id:item.id,summary:typeof item.summary==='string'?item.summary:'Calendario',primary:item.primary===true,writable:['owner','writer'].includes(item.accessRole),timeZone:typeof item.timeZone==='string'?item.timeZone:'UTC'}); }
      if(!data.nextPageToken) return items; page=String(data.nextPageToken);
    } throw new DomainError('INVALID_ARGUMENT','Demasiados calendarios para cargar de una vez.');
  }
  async select(uid:string,id:string) {
    const rows=await this.calendars(uid); if(!rows.some(row=>row.id===id || (id==='primary' && row.primary))) throw new DomainError('FORBIDDEN','Elige uno de tus calendarios disponibles.');
    this.db.prepare('UPDATE calendar_connections SET calendar_id=? WHERE user_id=?').run(id,uid); return this.status(uid);
  }
  async events(uid:string,from:number,to:number,page?:string) {
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||!Number.isFinite(new Date(from).getTime())||!Number.isFinite(new Date(to).getTime())||to<=from||to-from>93*86400000 || (page?.length??0)>2048) throw new DomainError('INVALID_ARGUMENT','El intervalo debe tener entre 1 y 93 días.');
    const id=this.connection(uid)?.calendar_id ?? 'primary';
    const params=new URLSearchParams({timeMin:new Date(from).toISOString(),timeMax:new Date(to).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'100',fields:'items(id,summary,start,end,htmlLink,status),nextPageToken,timeZone'}); if(page) params.set('pageToken',page);
    const {status,data}=await this.api(uid,`calendars/${encodeURIComponent(id)}/events?${params}`); if(status!==200||!Array.isArray(data.items)) throw unavailable();
    return { events:data.items.filter((e:Json)=>e.status!=='cancelled').map((e:Json)=>this.event(e,data.timeZone)), nextPageToken:typeof data.nextPageToken==='string'?data.nextPageToken:null, calendarId:id };
  }
  private event(e:Json,zone='UTC'):CalendarEvent {
    if(typeof e.id!=='string'||typeof (e.start?.dateTime??e.start?.date)!=='string'||typeof (e.end?.dateTime??e.end?.date)!=='string') throw unavailable();
    let url:string|null=null; try { const parsed=new URL(e.htmlLink); if(parsed.protocol==='https:' && ['calendar.google.com','www.google.com'].includes(parsed.hostname)) url=parsed.toString(); } catch {}
    return {id:e.id,title:typeof e.summary==='string'?e.summary:'Sin título',start:e.start.dateTime??e.start.date,end:e.end.dateTime??e.end.date,allDay:!!e.start.date,timeZone:e.start.timeZone??zone,url};
  }
  async create(uid:string,input:EventInput) {
    if(!input || typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||!Number.isSafeInteger(input.startEpochMs)||!Number.isSafeInteger(input.endEpochMs)||!Number.isFinite(new Date(input.startEpochMs).getTime())||!Number.isFinite(new Date(input.endEpochMs).getTime())||input.endEpochMs<=input.startEpochMs||input.endEpochMs-input.startEpochMs>7*86400000) throw new DomainError('INVALID_ARGUMENT','Revisa el título y las fechas del evento.');
    try { new Intl.DateTimeFormat('es',{timeZone:input.timeZone}).format(); if(typeof input.timeZone!=='string') throw Error(); } catch { throw new DomainError('INVALID_ARGUMENT','Zona horaria no válida.'); }
    const payloadHash=digest(JSON.stringify([input.title.trim(),input.startEpochMs,input.endEpochMs,input.timeZone]));
    let op=this.db.prepare('SELECT * FROM calendar_operations WHERE user_id=? AND operation_id=?').get(uid,input.operationId) as {payload_hash:string;calendar_id:string;event_id:string}|undefined;
    if(op && op.payload_hash!==payloadHash) throw new DomainError('VERSION_CONFLICT','Ese envío ya se usó con otros datos.');
    if(!op) {
      const selected=this.connection(uid)?.calendar_id??'primary'; const calendars=await this.calendars(uid); if(!calendars.some(c=>(c.id===selected||(selected==='primary'&&c.primary))&&c.writable)) throw new DomainError('FORBIDDEN','Este calendario es de solo lectura.');
      const eventId=digest(`${uid}:${input.operationId}`); this.db.prepare('INSERT OR IGNORE INTO calendar_operations VALUES (?,?,?,?,?)').run(uid,input.operationId,payloadHash,selected,eventId);
      op=this.db.prepare('SELECT * FROM calendar_operations WHERE user_id=? AND operation_id=?').get(uid,input.operationId) as {payload_hash:string;calendar_id:string;event_id:string}|undefined;
      if(!op||op.payload_hash!==payloadHash) throw new DomainError('VERSION_CONFLICT','El envío cambió durante la operación.');
    }
    const path=`calendars/${encodeURIComponent(op.calendar_id)}/events`;
    let result=await this.api(uid,path,{method:'POST',body:JSON.stringify({id:op.event_id,summary:input.title.trim(),start:{dateTime:new Date(input.startEpochMs).toISOString(),timeZone:input.timeZone},end:{dateTime:new Date(input.endEpochMs).toISOString(),timeZone:input.timeZone},reminders:{useDefault:false},extendedProperties:{private:{alarmatPayload:payloadHash}}})});
    if(result.status===409) { result=await this.api(uid,`${path}/${op.event_id}`); if(result.data.extendedProperties?.private?.alarmatPayload!==payloadHash) throw new DomainError('VERSION_CONFLICT','El evento ya existe con otros datos.'); }
    if(![200,201].includes(result.status)) throw unavailable(); return this.event(result.data,input.timeZone);
  }
  disconnect(uid:string) { this.db.transaction(()=>{this.db.prepare('DELETE FROM calendar_oauth WHERE user_id=?').run(uid); this.db.prepare('DELETE FROM calendar_oauth_results WHERE user_id=?').run(uid); this.db.prepare('DELETE FROM calendar_connections WHERE user_id=?').run(uid);})(); return {disconnected:true}; }
}
