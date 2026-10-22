import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCalendarPrefill } from '../src/features/calendar/prefill.ts';
import { demoProductState } from '../src/composition/demo.ts';

test('calendar deep link waits for task data and uses household timezone once available', () => {
  const state = demoProductState();
  state.session = { ...state.session!, mode: 'live' };
  const task = state.tasks[0]!;
  assert.equal(resolveCalendarPrefill({ ...state, tasks: [] }, { taskId: task.id }, 'Europe/Madrid'), null);
  const prefill = resolveCalendarPrefill(state, { taskId: task.id }, 'Europe/Madrid');
  assert.equal(prefill?.title, task.title);
  assert.equal(prefill?.timeZone, 'Europe/Madrid');
  assert.equal(resolveCalendarPrefill({ ...state, groupId: 'another-group' }, { taskId: task.id }, 'Europe/Madrid'), null);
});

test('calendar alarm copy requires current recipient acceptance and preserves their chosen time', () => {
  const state = demoProductState();
  state.session = { ...state.session!, mode: 'live' };
  const alarm = state.alarms[0]!;
  assert.equal(resolveCalendarPrefill(state, { alarmId: alarm.requestId }, 'UTC'), null);
  const recipient = alarm.recipients.find(item => item.uid === state.session!.userId)!;
  recipient.decision = 'ACCEPTED';
  recipient.acceptedRequestVersion = alarm.request.requestVersion;
  recipient.chosenTimeSpec = { ...alarm.request.timeSpec, localTime: '21:45' };
  assert.equal(resolveCalendarPrefill(state, { alarmId: alarm.requestId }, 'UTC')?.localTime, '21:45');
  recipient.acceptedRequestVersion = alarm.request.requestVersion - 1;
  assert.equal(resolveCalendarPrefill(state, { alarmId: alarm.requestId }, 'UTC'), null);
  assert.equal(resolveCalendarPrefill({ ...state, session: null }, { alarmId: alarm.requestId }, 'UTC'), null);
});
