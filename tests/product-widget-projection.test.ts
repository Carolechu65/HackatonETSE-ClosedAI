import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSelectedWidget } from '../src/composition/widgetProjection.ts';
import type { PersistedWidgetSnapshot } from '../src/data/repositories/alarmRepository.ts';

const snapshot: PersistedWidgetSnapshot = {
  schemaVersion: 1, userId: 'ana', generatedAtEpochMs: 5000, lastSyncedAtEpochMs: 1000, stale: true,
  groups: [
    { groupId: 'casa-a', pendingProposals: 7, pendingActivation: 2, pendingChanges: 0, cancelPending: 1, nextAlarm: null },
    { groupId: 'casa-b', pendingProposals: 1, pendingActivation: 0, pendingChanges: 0, cancelPending: 0, nextAlarm: {
      requestId: 'aviso-b', occurrenceId: 'oc-b', mode: 'ALARM', title: 'Cocina', proposedBy: 'luis', effectiveAtEpochMs: 9000, deepLink: 'alarmat://alarm/aviso-b', acknowledgementPending: false,
    } },
  ],
};
test('widget follows the selected household and preserves actual sync age', () => {
  const projected = projectSelectedWidget(snapshot, 'casa-b')!;
  assert.deepEqual(projected.scope, { userId: 'ana', groupId: 'casa-b' });
  assert.equal(projected.nextAlarm?.requestId, 'aviso-b');
  assert.equal(projected.counts.pendingProposals, 1);
  assert.equal(projected.generatedAtEpochMs, 1000);
});
test('an empty selected household does not display another household alarms', () => {
  const projected = projectSelectedWidget(snapshot, 'casa-sin-avisos')!;
  assert.equal(projected.scope?.groupId, 'casa-sin-avisos');
  assert.equal(projected.nextAlarm, null);
  assert.deepEqual(projected.counts, { pendingProposals: 0, pendingActivations: 0, withdrawalPending: 0 });
});
test('widget uses a default only before choosing a household and clears an empty account', () => {
  assert.equal(projectSelectedWidget(snapshot, null)?.scope?.groupId, 'casa-a');
  assert.equal(projectSelectedWidget({ ...snapshot, groups: [] }, null), null);
  assert.equal(projectSelectedWidget({ ...snapshot, lastSyncedAtEpochMs: null }, 'casa-a')?.generatedAtEpochMs, 0);
});
