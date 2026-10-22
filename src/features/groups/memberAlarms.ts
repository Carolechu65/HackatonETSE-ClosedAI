import type { ProductState } from '../../composition/product.ts';

/** Only proposals created by this viewer for this member in the selected home. */
export function memberAlarms(state: ProductState, groupId: string, userId: string) {
  if (!state.session || state.groupId !== groupId || !state.members.some(member => member.userId === userId)) return [];
  return state.alarms.filter(alarm => alarm.groupId === groupId
    && alarm.request.creatorUid === state.session!.userId
    && alarm.request.recipientUids.includes(userId))
    .sort((a, b) => b.request.createdAtEpochMs - a.request.createdAtEpochMs);
}
