import type { ProductState } from './product.ts';
import { createTimeSpec } from '../domain/time.ts';

/** Explicit, isolated fixtures. Never mixed with a remotely authenticated session. */
export function demoProductState(): ProductState {
  const now = Date.now();
  const timeZone = 'Europe/Madrid';
  const time = (minutes: number) => {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now + minutes * 60_000)).split(' ');
    return createTimeSpec({ localDate: parts[0]!, localTime: parts[1]!, timeZone });
  };
  return {
    ready: true, session: { userId: 'demo-ana', displayName: 'Ana', mode: 'demo' },
    groupId: 'demo-casa', groups: [{ id: 'demo-casa', name: 'Casa del sol', timeZone, role: 'owner' }],
    members: [{ userId: 'demo-ana', displayName: 'Ana', role: 'owner' }, { userId: 'demo-dani', displayName: 'Dani', role: 'member' }, { userId: 'demo-lucia', displayName: 'Lucía', role: 'member' }],
    alarms: [
      { requestId: 'demo-basura', groupId: 'demo-casa', request: { title: 'Bajar la basura', note: 'Antes de que pase el camión. ¡Gracias!', creatorUid: 'demo-dani', recipientUids: ['demo-ana'], mode: 'ALARM', timeSpec: time(90), requestVersion: 1, status: 'ACTIVE', createdAtEpochMs: now, updatedAtEpochMs: now }, recipients: [{ uid: 'demo-ana', receivedVersion: 1, reception: 'RECEIVED', decision: 'PENDING', decisionRevision: 1, updatedAtEpochMs: now }], schedules: [] },
      { requestId: 'demo-plantas', groupId: 'demo-casa', request: { title: 'Un poco de agua a las plantas', note: 'Las de la ventana tienen sed.', creatorUid: 'demo-lucia', recipientUids: ['demo-ana'], mode: 'NOTIFICATION', timeSpec: time(180), requestVersion: 1, status: 'ACTIVE', createdAtEpochMs: now - 60_000, updatedAtEpochMs: now }, recipients: [{ uid: 'demo-ana', receivedVersion: 1, reception: 'RECEIVED', decision: 'ACCEPTED', acceptedRequestVersion: 1, consentScope: 'THIS_OCCURRENCE', decisionRevision: 2, updatedAtEpochMs: now }], schedules: [] },
    ],
    tasks: [
      { id: 'demo-cocina', groupId: 'demo-casa', title: 'Dejar la cocina a punto', assigneeUid: 'demo-ana', createdByUid: 'demo-dani', activateAtEpochMs: null, dueAtEpochMs: now + 3_600_000 * 5, status: 'pending', version: 1, completedByUid: null, completedAtEpochMs: null },
      { id: 'demo-compra', groupId: 'demo-casa', title: 'Comprar café y leche', assigneeUid: 'demo-dani', createdByUid: 'demo-ana', activateAtEpochMs: null, dueAtEpochMs: null, status: 'pending', version: 1, completedByUid: null, completedAtEpochMs: null },
      { id: 'demo-bano', groupId: 'demo-casa', title: 'Limpiar el baño', assigneeUid: 'demo-lucia', createdByUid: 'demo-ana', activateAtEpochMs: null, dueAtEpochMs: null, status: 'completed', version: 2, completedByUid: 'demo-lucia', completedAtEpochMs: now - 3_600_000 },
    ],
    syncing: false, pending: 0, lastSync: null, error: null,
  };
}
