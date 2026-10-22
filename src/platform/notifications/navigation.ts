import type { ProductClient } from '../../composition/product.ts';
import { DomainError } from '../../domain/errors.ts';
import { isSafeLinkId } from '../../widgets/links.ts';

export type AssignmentDestination = { kind: 'alarm' | 'task'; groupId: string; entityId: string };
export function assignmentDestination(value: unknown): AssignmentDestination | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const kind = data.kind === 'task' || data.kind === 'task-assignment' ? 'task'
    : data.kind === 'alarm' || data.kind === 'proposal' || data.kind === 'accepted-reminder' ? 'alarm' : null;
  const entityId = data.entityId ?? (kind === 'task' ? data.taskId : data.requestId);
  return kind && isSafeLinkId(entityId) && isSafeLinkId(data.groupId)
    ? { kind, entityId, groupId: data.groupId } : null;
}

/** Refresh membership before following a notice from another household; never mutate from the tap. */
export async function prepareAssignmentNavigation(client: ProductClient, destination: AssignmentDestination) {
  const userId = client.getSnapshot().session?.mode === 'live' ? client.getSnapshot().session?.userId : null;
  if (!userId) throw new DomainError('UNAUTHENTICATED', 'Inicia sesión para consultar este aviso.');
  const assertCurrent = () => {
    if (client.getSnapshot().session?.userId !== userId || client.getSnapshot().session?.mode !== 'live') {
      throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado. Abre de nuevo el aviso.');
    }
  };
  await client.refresh(); assertCurrent();
  if (!client.getSnapshot().groups.some(group => group.id === destination.groupId)) {
    throw new DomainError('FORBIDDEN', 'Ya no tienes acceso al piso de este aviso.');
  }
  await client.selectGroup(destination.groupId); assertCurrent();
  if (client.getSnapshot().groupId !== destination.groupId) throw new DomainError('FORBIDDEN', 'No se pudo abrir el piso del aviso.');
  return destination.kind === 'task' ? `/task/${destination.entityId}` as const : `/alarm/${destination.entityId}` as const;
}
