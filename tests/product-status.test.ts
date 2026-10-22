import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmStatus, recipientAlarmStatus, type ProductAlarm } from '../src/composition/product.ts';
import { alarm, scheduleAndAck } from './data/local/fixtures.ts';

function fixture(): ProductAlarm {
  const record = alarm();
  record.request.timeSpec.effectiveAtEpochMs = Date.now() + 60_000;
  return { groupId: record.groupId, requestId: record.requestId, request: record.request,
    recipients: [record.recipient, { ...record.recipient, uid: 'bea' }], schedules: [] };
}

test('creator sees each recipient execution only from its own schedule envelope', () => {
  const item = fixture(), payload = { ...scheduleAndAck().ack.payload, decisionRevision: 2, mode: item.request.mode };
  item.schedulesByRecipient = { ana: [{ ...payload, status: 'SCHEDULED', statusUpdatedAtEpochMs: Date.now() }] };
  const ana = recipientAlarmStatus(item, item.recipients[0]!, 'creator');
  const bea = recipientAlarmStatus(item, item.recipients[1]!, 'creator');
  assert.equal(ana.decision, 'Aceptada');
  assert.equal(ana.execution, 'Programada en el móvil');
  assert.equal(bea.decision, 'Aceptada');
  assert.equal(bea.execution, 'Sin programación confirmada');
  item.localStatus = 'SCHEDULED';
  assert.equal(recipientAlarmStatus(item, item.recipients[1]!, 'ana').execution, 'Sin programación confirmada');
});

test('latest execution report wins over a past scheduling success', () => {
  const item = fixture(), payload = { ...scheduleAndAck().ack.payload, decisionRevision: 2, mode: item.request.mode };
  item.schedulesByRecipient = { ana: [
    { ...payload, status: 'SCHEDULED', statusUpdatedAtEpochMs: 1 },
    { ...payload, status: 'CANCEL_PENDING', statusUpdatedAtEpochMs: 2 },
  ] };
  assert.equal(recipientAlarmStatus(item, item.recipients[0]!, 'creator').execution, 'Cancelación pendiente');
  assert.equal(alarmStatus(item, 'ana').title, 'Cancelación pendiente');
});

test('native future snooze is shown scheduled even after original consented time elapsed', () => {
  const item = fixture();
  item.request.timeSpec.effectiveAtEpochMs = Date.now() - 60_000;
  item.localStatus = 'SCHEDULED'; item.localEffectiveAtEpochMs = Date.now() + 60_000;
  assert.equal(alarmStatus(item, 'ana').title, 'Programada en el móvil');
});

test('request version and decision revision mismatches never become a programming confirmation', () => {
  const item = fixture(), payload = scheduleAndAck().ack.payload;
  item.schedulesByRecipient = { ana: [{ ...payload, requestVersion: 99, status: 'SCHEDULED', statusUpdatedAtEpochMs: Date.now() }] };
  assert.equal(recipientAlarmStatus(item, item.recipients[0]!, 'creator').execution, 'Sin programación confirmada');
});
