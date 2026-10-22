import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { AppShell } from '../../ui/AppShell.tsx';
import { Action, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Note } from '../../ui/Note.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { typography } from '../../ui/theme.ts';
import { wallClockToEpochMs, formatDateTimeInZone } from '../../domain/time.ts';
import { createIdGenerator } from '../../domain/ids.ts';
import { resolveCalendarPrefill } from './prefill.ts';
import type { CalendarChoice, CalendarEvent, CalendarStatus, EventDraft } from './client.ts';

export function CalendarScreen() {
  const { state }=useProduct();
  return <AppShell title="Tu calendario" eyebrow="TUS PLANES, EN SU SITIO"><CalendarContent key={`${state.session?.userId}:${state.session?.mode}`} /></AppShell>;
}
function CalendarContent() {
  const { state,client,group }=useProduct();const api=client.calendar;
  const params=useLocalSearchParams<{completion?:string;alarmId?:string;taskId?:string}>();
  const [status,setStatus]=useState<CalendarStatus|null>(null);const [calendars,setCalendars]=useState<CalendarChoice[]>([]);const [events,setEvents]=useState<CalendarEvent[]>([]);
  const [page,setPage]=useState<string|null>(null);const [offset,setOffset]=useState(0);const [notice,setNotice]=useState<string|null>(null);const [loading,setLoading]=useState(false);
  const [title,setTitle]=useState('');const [date,setDate]=useState('');const [time,setTime]=useState('');const [minutes,setMinutes]=useState('30');const [zone,setZone]=useState(group?.timeZone??'Europe/Madrid');
  const [confirmDisconnect,setConfirmDisconnect]=useState(false);const [waiting,setWaiting]=useState(false);
  const action=useAction();const popup=useRef<Window|null>(null);const origin=useRef('');const alive=useRef(true);const sequence=useRef(0);const submitting=useRef(false);const completionUsed=useRef('');const operation=useRef<{key:string;draft:EventDraft}|null>(null);
  const prefillKey = `${state.session?.userId}:${state.groupId}:${params.alarmId ?? ''}:${params.taskId ?? ''}`;
  const prefillUsed = useRef('');
  const edit = (setter: (value: string) => void) => (value: string) => { prefillUsed.current = prefillKey; setter(value); };
  const rangeStart=new Date();rangeStart.setHours(0,0,0,0);rangeStart.setDate(rangeStart.getDate()+offset*7);const from=rangeStart.getTime();const rangeEnd=new Date(from);rangeEnd.setDate(rangeEnd.getDate()+7);const to=rangeEnd.getTime();
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;popup.current?.close();};},[]);
  const refresh=useCallback(async()=>{
    if(state.session?.mode!=='live')return;const run=++sequence.current;setLoading(true);setEvents([]);setPage(null);
    try { const next=await api.status();if(!alive.current||run!==sequence.current)return;setStatus(next);
      if(next.connected){const [choices,result]=await Promise.all([api.calendars(),api.events(from,to)]);if(!alive.current||run!==sequence.current)return;setCalendars(choices);setEvents(result.events);setPage(result.nextPageToken);}
      else setCalendars([]);
    } finally {if(alive.current&&run===sequence.current)setLoading(false);}
  },[api,state.session?.mode,from,to]);
  useEffect(()=>{void refresh().catch(error=>{if(alive.current)action.setError(error instanceof Error?error.message:'No se pudo leer el calendario.');});},[refresh]);
  const finish=useCallback(async(completion:string)=>{
    if(!/^[A-Za-z0-9_-]{43}$/.test(completion)||completionUsed.current===completion)return;completionUsed.current=completion;
    try {await api.complete(completion);if(!alive.current)return;setWaiting(false);setNotice('Google Calendar conectado a tu cuenta.');popup.current?.close();await refresh();}
    catch(error){completionUsed.current='';throw error;}
  },[api,refresh]);
  useEffect(()=>{
    if(Platform.OS!=='web')return;
    const listener=(event:MessageEvent)=>{if(event.origin!==origin.current||event.source!==popup.current||event.data?.type!=='alarmat-calendar-complete'||typeof event.data.completion!=='string')return;void action.run(()=>finish(event.data.completion));};
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[finish]);
  useEffect(()=>{if(params.completion&&state.session?.mode==='live'){void action.run(async()=>{await finish(params.completion!);router.setParams({completion:undefined});});}},[params.completion,state.session?.mode,finish]);
  useEffect(()=>{const subscription=AppState.addEventListener('change',next=>{if(next==='active')void refresh().catch(()=>{});});return()=>subscription.remove();},[refresh]);
  useEffect(() => {
    if (prefillUsed.current === prefillKey) return;
    const prefill = resolveCalendarPrefill(state, params, group?.timeZone ?? 'Europe/Madrid');
    if (!prefill) return;
    prefillUsed.current = prefillKey;
    setTitle(prefill.title); setDate(prefill.localDate); setTime(prefill.localTime); setZone(prefill.timeZone);
  }, [prefillKey, state.alarms, state.tasks, state.session, state.groupId, params.alarmId, params.taskId, group?.timeZone]);
  const connect=()=>{
    if(Platform.OS==='web'){popup.current=window.open('about:blank','alarmat-google','width=560,height=720');if(!popup.current){action.setError('Permite la ventana de Google para conectar tu calendario.');return;}}
    void action.run(async()=>{try {const url=await api.connect();origin.current=new URL(url).origin;setWaiting(true);if(Platform.OS==='web'&&popup.current)popup.current.location.href=url;else await Linking.openURL(url);}catch(error){popup.current?.close();throw error;}});
  };
  const create=()=>{if(submitting.current || action.busy)return;submitting.current=true;void action.run(async()=>{
      const startEpochMs=wallClockToEpochMs({localDate:date,localTime:time,timeZone:zone});const duration=Number(minutes);
      if(!Number.isSafeInteger(duration)||duration<1||duration>10080)throw new Error('La duración debe ser de entre 1 minuto y 7 días.');
      if(!title.trim())throw new Error('Pon un título al evento.');
      const payload={title:title.trim(),startEpochMs,endEpochMs:startEpochMs+duration*60000,timeZone:zone};const key=JSON.stringify(payload);
      if(operation.current?.key!==key)operation.current={key,draft:{...payload,operationId:createIdGenerator().next('calendar')}};
      await api.create(operation.current.draft);if(!alive.current)return;setNotice('Evento guardado en Google Calendar.');operation.current=null;setTitle('');await refresh();
  }).finally(() => { submitting.current = false; });};
  if(state.session?.mode!=='live')return <Note index={1} label="TU CUENTA" title="Conecta tu calendario personal"><Text style={typography.body}>Entra con tu cuenta de alarmaT para autorizar Google Calendar. La demostración no accede a calendarios reales.</Text><Action onPress={()=>router.push('/settings')}>Entrar con mi cuenta</Action></Note>;
  const selected=calendars.find(c=>c.id===status?.calendarId||(status?.calendarId==='primary'&&c.primary));
  return <View style={{maxWidth:850,width:'100%',gap:24}}>
    <Note index={1} label="GOOGLE CALENDAR" title={status?.connected?'Tus planes, contigo.':'Conecta tu calendario.'} style={{padding:24,gap:14}}>
      <Text style={typography.body}>Consulta tus eventos y lleva tus compromisos al calendario que elijas. Solo tu cuenta puede ver esta agenda en alarmaT.</Text>
      {!status?<Text style={typography.support}>{loading?'Comprobando conexión…':'No se pudo comprobar la conexión.'}</Text>:!status.configured?<Text style={typography.body}>La conexión con Google Calendar todavía no está configurada en el servidor.</Text>:!status.connected?<><Message text={status.reconnectRequired?'El permiso de Google ha caducado. Conecta de nuevo para recuperar tu agenda.':null}/><PrimaryAction disabled={action.busy} label={waiting?'Volver a abrir Google':'Conectar Google Calendar'} onPress={connect}/>{waiting?<Text style={typography.support}>Elige tu cuenta y autoriza el calendario en la ventana de Google. Después vuelve aquí.</Text>:null}</>:<>
        <Text style={typography.labelOnNote}>CALENDARIO ELEGIDO</Text><View style={{gap:8}}>{calendars.map(c=><Action key={c.id} disabled={action.busy||loading} selected={c.id===status.calendarId||(status.calendarId==='primary'&&c.primary)} onPress={()=>void action.run(async()=>{await api.select(c.id);await refresh();})}>{c.summary}{c.primary?' · principal':''}{!c.writable?' · solo lectura':''}</Action>)}</View>
        <Action disabled={action.busy} onPress={()=>setConfirmDisconnect(true)}>Desconectar Google Calendar</Action>
        {confirmDisconnect?<><Text style={typography.support}>Se elimina el acceso guardado en alarmaT. Tus eventos de Google se conservan.</Text><Action disabled={action.busy} onPress={()=>void action.run(async()=>{await api.disconnect();setConfirmDisconnect(false);setNotice('Google Calendar desconectado.');await refresh();})}>Confirmar desconexión</Action><Action onPress={()=>setConfirmDisconnect(false)}>Conservar conexión</Action></>:null}
      </>}
    </Note>
    <Message text={notice}/><Message text={action.error} error/>
    <Action disabled={action.busy||loading} onPress={()=>void action.run(refresh)}>Actualizar calendario</Action>
    {status?.connected?<>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}><Action disabled={loading||action.busy} onPress={()=>setOffset(o=>o-1)}>Semana anterior</Action><Action disabled={loading||action.busy} onPress={()=>setOffset(0)}>Esta semana</Action><Action disabled={loading||action.busy} onPress={()=>setOffset(o=>o+1)}>Semana siguiente</Action></View>
      <Text style={typography.noteTitle}>{new Date(from).toLocaleDateString('es-ES')} — {new Date(to-1).toLocaleDateString('es-ES')}</Text>
      {loading?<Text style={typography.body}>Cargando tus eventos…</Text>:events.length===0?<Note index={4} label="TU AGENDA" title="Sin eventos en estos días"><Text style={typography.body}>Puedes añadir un plan abajo o consultar otra semana.</Text></Note>:events.map((event,index)=><Note key={event.id} index={index+2} label={event.allDay?'TODO EL DÍA':'TU AGENDA'} title={event.title} style={{padding:22,gap:8}}><Text style={typography.body}>{event.allDay?event.start:formatDateTimeInZone(Date.parse(event.start),event.timeZone)}</Text>{!event.allDay?<Text style={typography.support}>Hasta {formatDateTimeInZone(Date.parse(event.end),event.timeZone)} · {event.timeZone}</Text>:null}{event.url?<Action onPress={()=>void action.run(()=>Linking.openURL(event.url!).then(()=>{}))}>Abrir en Google Calendar</Action>:null}</Note>)}
      {page?<Action disabled={action.busy||loading} onPress={()=>void action.run(async()=>{const result=await api.events(from,to,page);if(!alive.current)return;setEvents(old=>[...new Map([...old,...result.events].map(e=>[e.id,e])).values()]);setPage(result.nextPageToken);})}>Cargar más eventos</Action>:null}
      <Sheet style={{gap:12,padding:24}}><Text style={typography.noteTitle}>Añadir un compromiso</Text><Text style={typography.support}>Se guarda una copia en Google Calendar, sin activar alarmas ni invitar a otras personas. Los cambios posteriores se hacen en Google Calendar.</Text>
        <Field label="Título del evento" value={title} onChangeText={edit(setTitle)} maxLength={160} editable={!action.busy}/><Field label="Fecha · AAAA-MM-DD" value={date} onChangeText={edit(setDate)} placeholder="2026-10-24" editable={!action.busy}/><Field label="Hora · HH:mm" value={time} onChangeText={edit(setTime)} placeholder="18:00" editable={!action.busy}/><Field label="Duración en minutos" value={minutes} onChangeText={edit(setMinutes)} keyboardType="numeric" editable={!action.busy}/><Field label="Zona horaria" value={zone} onChangeText={edit(setZone)} autoCapitalize="none" editable={!action.busy}/>
      </Sheet><PrimaryAction label={action.busy?'Guardando…':'Guardar en mi Google Calendar'} disabled={action.busy||!selected?.writable} onPress={create}/>{selected&&!selected.writable?<Text style={typography.support}>Elige un calendario con permiso de escritura para añadir eventos.</Text>:null}
    </>:null}
  </View>;
}
