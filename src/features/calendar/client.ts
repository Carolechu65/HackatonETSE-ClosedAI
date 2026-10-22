import { DomainError } from '../../domain/errors.ts';
export type CalendarStatus = { configured: boolean; connected: boolean; reconnectRequired: boolean; calendarId: string };
export type CalendarChoice = { id: string; summary: string; primary: boolean; writable: boolean; timeZone: string };
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; timeZone: string; url: string | null };
export type EventDraft = { operationId: string; title: string; startEpochMs: number; endEpochMs: number; timeZone: string };
export type CalendarPage = { events: CalendarEvent[]; nextPageToken: string | null; calendarId: string };
export type CalendarTransport = (path:string,method?:'GET'|'POST',body?:unknown)=>Promise<unknown>;
const bad = () => new DomainError('TEMPORARY_UNAVAILABLE','No se pudo leer la respuesta del calendario.');
function record(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw bad();return value as Record<string,unknown>;}
function string(value:unknown):string {if(typeof value!=='string')throw bad();return value;}
function bool(value:unknown):boolean {if(typeof value!=='boolean')throw bad();return value;}
function status(value:unknown):CalendarStatus {const v=record(value);return {configured:bool(v.configured),connected:bool(v.connected),reconnectRequired:bool(v.reconnectRequired),calendarId:string(v.calendarId)};}
function event(value:unknown):CalendarEvent {const v=record(value);return {id:string(v.id),title:string(v.title),start:string(v.start),end:string(v.end),allDay:bool(v.allDay),timeZone:string(v.timeZone),url:v.url===null?null:string(v.url)};}
const base='/v1/calendar/google';
export function createCalendarClient(request:CalendarTransport) {
  return {
    async status(){return status(await request(`${base}/status`));},
    async connect(){const url=new URL(string(record(await request(`${base}/connect`,'POST',{})).url));if(url.protocol!=='https:'||url.username||url.password||!url.pathname.endsWith('/v1/calendar/google/start'))throw bad();return url.toString();},
    async complete(completion:string){return status(await request(`${base}/complete`,'POST',{completion}));},
    async disconnect(){await request(`${base}/disconnect`,'POST',{});},
    async calendars():Promise<CalendarChoice[]>{const v=record(await request(`${base}/calendars`));if(!Array.isArray(v.calendars))throw bad();return v.calendars.map(item=>{const r=record(item);return {id:string(r.id),summary:string(r.summary),primary:bool(r.primary),writable:bool(r.writable),timeZone:string(r.timeZone)};});},
    async select(calendarId:string){return status(await request(`${base}/select`,'POST',{calendarId}));},
    async events(from:number,to:number,page?:string):Promise<CalendarPage>{const v=record(await request(`${base}/events?from=${from}&to=${to}${page?`&page=${encodeURIComponent(page)}`:''}`));if(!Array.isArray(v.events))throw bad();return {events:v.events.map(event),calendarId:string(v.calendarId),nextPageToken:v.nextPageToken===null?null:string(v.nextPageToken)};},
    async create(draft:EventDraft){return event(record(await request(`${base}/events`,'POST',draft)).event);},
  };
}
export type CalendarClient = ReturnType<typeof createCalendarClient>;
