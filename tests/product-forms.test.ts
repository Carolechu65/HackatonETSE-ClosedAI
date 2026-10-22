import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmPayload, createSubmissionIds, responsePayload, type AlarmForm } from '../src/features/alarms/form.ts';

const NOW = Date.parse('2026-03-01T10:00:00Z');
const context = { groupId: 'piso-1', memberIds: ['ana', 'luis'], openTaskIds: ['task-1'], nowEpochMs: NOW };
const form: AlarmForm = { title: '  Sacar la basura ', note: '', recipientUids: ['luis', 'ana'], localDate: '2026-03-29', localTime: '02:30', timeZone: 'Europe/Madrid', mode: 'ALARM', weekly: false, taskId: '' };

test('alarm form resolves DST through domain policy and preserves chosen recipients and mode', () => {
  const payload = alarmPayload(form, context);
  assert.equal(payload.title, 'Sacar la basura');
  assert.equal(payload.timeSpec.localTime, '02:30');
  assert.equal(payload.timeSpec.effectiveAtEpochMs, Date.parse('2026-03-29T01:30:00Z'));
  assert.deepEqual(payload.recipientUids, ['ana', 'luis']);
  assert.equal(payload.mode, 'ALARM');
  assert.equal(payload.recurrence, undefined);
  assert.equal(payload.note, undefined);
});

test('weekly alarm uses selected date weekday and does not silently activate the series', () => {
  const payload = alarmPayload({ ...form, weekly: true, taskId: 'task-1', mode: 'NOTIFICATION' }, context);
  assert.deepEqual(payload.recurrence, { kind: 'WEEKLY', isoWeekday: 7, localTime: '02:30' });
  assert.equal(payload.taskId, 'task-1');
  assert.equal('decision' in payload, false);
});

test('invalid dates, past times, removed members and closed tasks cannot be submitted', () => {
  for (const change of [
    { title: ' ' }, { recipientUids: [] }, { recipientUids: ['outsider'] },
    { recipientUids: ['ana', 'ana'] }, { taskId: 'closed' },
    { localDate: '2026-02-30' }, { localDate: '2026-02-28' },
    { localTime: '24:01' }, { timeZone: 'Invented/Zone' },
  ]) assert.throws(() => alarmPayload({ ...form, ...change }, context));
});

test('one logical operation retains its ID on retry while payload and group changes are distinct', () => {
  let counter = 0;
  const id = createSubmissionIds(() => `op-${++counter}`);
  const payload = alarmPayload(form, context);
  assert.equal(id('piso-1', payload), 'op-1');
  assert.equal(id('piso-1', { ...payload }), 'op-1');
  assert.equal(id('piso-2', payload), 'op-2');
  assert.equal(id('piso-1', { ...payload, title: 'Otro aviso' }), 'op-3');
  assert.equal(id('piso-1', payload), 'op-1');
});

test('choosing another hour needs explicit ACCEPTED and a future resolved time', () => {
  const input = { groupId: 'piso-1', requestId: 'request-1', requestVersion: 2, decisionRevision: 3,
    decision: 'ACCEPTED' as const, consentScope: 'THIS_OCCURRENCE' as const,
    chosen: { localDate: '2026-03-29', localTime: '02:30', timeZone: 'Europe/Madrid' }, nowEpochMs: NOW };
  const result = responsePayload(input);
  assert.equal(result.consentScope, 'THIS_OCCURRENCE');
  assert.equal(result.chosenTimeSpec?.effectiveAtEpochMs, Date.parse('2026-03-29T01:30:00Z'));
  assert.throws(() => responsePayload({ ...input, nowEpochMs: Date.parse('2026-04-01T10:00:00Z') }));
  assert.deepEqual(responsePayload({ ...input, decision: 'REJECTED' }), { decision: 'REJECTED' });
  assert.deepEqual(responsePayload({ ...input, decision: 'DISABLED' }), { decision: 'DISABLED' });
});


test('reviewing an assistant draft preserves the series end instead of making it indefinite', () => {
  const untilEpochMs = Date.parse('2026-05-01T10:00:00Z');
  const payload = alarmPayload({ ...form, weekly: true, untilEpochMs }, context);
  assert.equal(payload.recurrence?.untilEpochMs, untilEpochMs);
  assert.throws(() => alarmPayload({ ...form, weekly: true, untilEpochMs: NOW }, context));
});
