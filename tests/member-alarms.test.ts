import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoProductState } from '../src/composition/demo.ts';
import { memberAlarms } from '../src/features/groups/memberAlarms.ts';

test('member view only shows my proposals to that member in the selected home, newest first', () => {
  const state = demoProductState();
  const base = state.alarms[0]!;
  const sent = { ...base, requestId: 'sent', request: { ...base.request, creatorUid: 'demo-ana', recipientUids: ['demo-dani'], createdAtEpochMs: 1 } };
  const newer = { ...sent, requestId: 'notification', request: { ...sent.request, mode: 'NOTIFICATION' as const, createdAtEpochMs: 2 } };
  state.alarms.push(sent, newer,
    { ...sent, requestId: 'other-home', groupId: 'other' },
    { ...sent, requestId: 'other-author', request: { ...sent.request, creatorUid: 'demo-lucia' } },
    { ...sent, requestId: 'other-person', request: { ...sent.request, recipientUids: ['demo-lucia'] } });
  assert.deepEqual(memberAlarms(state, 'demo-casa', 'demo-dani').map(item => item.requestId), ['notification', 'sent']);
  assert.deepEqual(memberAlarms(state, 'other', 'demo-dani'), []);
  state.members = state.members.filter(member => member.userId !== 'demo-dani');
  assert.deepEqual(memberAlarms(state, 'demo-casa', 'demo-dani'), []);
  state.session = null;
  assert.deepEqual(memberAlarms(state, 'demo-casa', 'demo-ana'), []);
});
