import type { ProductState } from '../../composition/product.ts';

export type CalendarPrefill = { title: string; localDate: string; localTime: string; timeZone: string };

/** Deep-link data may arrive after authentication; never use another group's entity. */
export function resolveCalendarPrefill(
  state: Pick<ProductState, 'session' | 'groupId' | 'alarms' | 'tasks'>,
  params: { alarmId?: string; taskId?: string },
  timeZone: string,
): CalendarPrefill | null {
  if (!state.session || state.session.mode !== 'live' || !state.groupId) return null;
  if (params.alarmId) {
    const alarm = state.alarms.find(item => item.requestId === params.alarmId && item.groupId === state.groupId);
    const recipient = alarm?.recipients.find(item => item.uid === state.session!.userId);
    if (!alarm || alarm.request.status !== 'ACTIVE' || recipient?.decision !== 'ACCEPTED'
      || recipient.acceptedRequestVersion !== alarm.request.requestVersion) return null;
    const timing = recipient.chosenTimeSpec ?? alarm.request.timeSpec;
    return { title: alarm.request.title, localDate: timing.localDate, localTime: timing.localTime, timeZone: timing.timeZone };
  }
  const task = state.tasks.find(item => item.id === params.taskId && item.groupId === state.groupId && item.status === 'pending');
  if (!task) return null;
  const instant = task.dueAtEpochMs ?? task.activateAtEpochMs;
  if (instant === null) return { title: task.title, localDate: '', localTime: '', timeZone };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map(value => [value.type, value.value]));
  return { title: task.title, localDate: `${p.year}-${p.month}-${p.day}`, localTime: `${p.hour}:${p.minute}`, timeZone };
}
