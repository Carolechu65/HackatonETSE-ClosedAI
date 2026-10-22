import { DomainError } from '../../../src/domain/errors.ts';
import type { AlarmRequestDocument,RecipientDocument,ScheduleDocument } from '../../../src/domain/contracts/types.ts';
import type { Db } from '../persistence/db.ts';
import { requireActiveMembership,isActiveMember } from '../groups/service.ts';
import { createOpaqueToken } from '../lib/crypto.ts';
import { alarmRequestDto,recipientDto,scheduleDto,getAlarmRequest,getRecipient,getRecipientUids,type ScheduleRow } from '../operations/dto.ts';
export type AlarmRecord={groupId:string;requestId:string;request:AlarmRequestDocument;recipient:RecipientDocument;primaryDevice:{deviceId:string;deviceEpoch:number}|null;schedules:ScheduleDocument[]};
export function readAlarmRecord(db:Db,user:string,groupId:string,requestId:string,recipientUid=user):AlarmRecord{
 requireActiveMembership(db,groupId,user);const row=getAlarmRequest(db,requestId),recipient=getRecipient(db,requestId,recipientUid);
 if(!row||row.group_id!==groupId||!recipient||(user!==row.creator_uid&&user!==recipientUid))throw new DomainError('NOT_FOUND','Propuesta no encontrada.');
 const primary=db.prepare('SELECT primary_device_id,device_epoch FROM users WHERE id=?').get(recipientUid) as {primary_device_id:string|null;device_epoch:number};
 const schedules=db.prepare('SELECT * FROM device_schedules WHERE request_id=? AND uid=? ORDER BY status_updated_at_epoch_ms DESC LIMIT 128').all(requestId,recipientUid) as ScheduleRow[];
 return {groupId,requestId,request:{...alarmRequestDto(row),recipientUids:getRecipientUids(db,requestId)},recipient:recipientDto(recipient),primaryDevice:primary.primary_device_id?{deviceId:primary.primary_device_id,deviceEpoch:primary.device_epoch}:null,schedules:schedules.map(scheduleDto)};
}
export function listAlarmRecords(db:Db,user:string,groupId:string):{alarms:AlarmRecord[]}{
 requireActiveMembership(db,groupId,user);const rows=db.prepare('SELECT a.id,r.uid FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id WHERE a.group_id=? AND (a.creator_uid=? OR r.uid=?) ORDER BY a.updated_at_epoch_ms DESC LIMIT 500').all(groupId,user,user) as {id:string;uid:string}[];
 return {alarms:rows.map(row=>readAlarmRecord(db,user,groupId,row.id,row.uid))};
}
export type ProjectionEvent={eventId:string;kind:'upsert';alarm:AlarmRecord}|{eventId:string;kind:'revoke';groupId:string;requestId?:string};
export function readAlarmProjection(db:Db,user:string,cursor:string|null,limit=100,now=Date.now()):{events:ProjectionEvent[];nextCursor:string;hasMore:boolean;serverTimeEpochMs:number}{
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new DomainError('INVALID_ARGUMENT','Límite entre 1 y 100.');
 return db.transaction(()=>{
 let sequence=0;if(cursor!==null){if(typeof cursor!=='string'||cursor.length>100)throw new DomainError('INVALID_ARGUMENT','Cursor inválido.');const row=db.prepare('SELECT sequence,expires_at_epoch_ms FROM alarm_projection_cursors WHERE token=? AND user_id=?').get(cursor,user) as {sequence:number;expires_at_epoch_ms:number}|undefined;if(!row)throw new DomainError('INVALID_ARGUMENT','Cursor no válido para la sesión.');if(row.expires_at_epoch_ms<=now)throw new DomainError('EXPIRED','El cursor caducó. Reinicia la instantánea.');sequence=row.sequence;}
 const rows=db.prepare('SELECT sequence,group_id,request_id,kind FROM alarm_projection_events WHERE user_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(user,sequence,limit+1) as {sequence:number;group_id:string;request_id:string|null;kind:'upsert'|'revoke'}[];
 const events:ProjectionEvent[]=rows.slice(0,limit).map(row=>{sequence=row.sequence;if(row.kind==='revoke'||!isActiveMember(db,row.group_id,user)||!row.request_id)return {eventId:String(row.sequence),kind:'revoke',groupId:row.group_id,...(row.request_id?{requestId:row.request_id}:{})};return {eventId:String(row.sequence),kind:'upsert',alarm:readAlarmRecord(db,user,row.group_id,row.request_id)};});
 const nextCursor=createOpaqueToken();db.prepare('INSERT INTO alarm_projection_cursors VALUES (?,?,?,?)').run(nextCursor,user,sequence,now+7*86400000);db.prepare('DELETE FROM alarm_projection_cursors WHERE expires_at_epoch_ms<?').run(now-86400000);
 return {events,nextCursor,hasMore:rows.length>limit,serverTimeEpochMs:now};
 })();
}
