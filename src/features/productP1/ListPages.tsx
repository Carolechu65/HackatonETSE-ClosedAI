import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, typography } from '../../ui/index.ts';

/** Pagination affects only presentation; callers keep their complete totals. */
export function useListPages<T extends { id: string }>(items: T[], scope: string, size: number) {
  const [cursor, setCursor] = useState<{ scope: string; page: number; revealId?: string }>({ scope, page: 0 });
  const count = Math.max(1, Math.ceil(items.length / size));
  const revealIndex = cursor.scope === scope && cursor.revealId
    ? items.findIndex(item => item.id === cursor.revealId) : -1;
  const page = cursor.scope !== scope ? 0 : revealIndex >= 0
    ? Math.floor(revealIndex / size) : Math.min(cursor.page, count - 1);
  useEffect(() => {
    if (cursor.scope !== scope || cursor.page !== page || revealIndex >= 0)
      setCursor({ scope, page, ...(cursor.scope === scope && revealIndex < 0 && cursor.revealId ? { revealId: cursor.revealId } : {}) });
  }, [scope, page, cursor.scope, cursor.page, cursor.revealId, revealIndex]);
  return {
    items: items.slice(page * size, (page + 1) * size), page, count,
    select: (next: number) => setCursor({ scope, page: Math.max(0, Math.min(next, count - 1)) }),
    reveal: (id: string) => setCursor({ scope, page: 0, revealId: id }),
  };
}

export function ListPages({ page, count, total, label, onSelect }: {
  page: number; count: number; total: number; label: string; onSelect: (page: number) => void;
}) {
  if (count < 2) return null;
  return <View style={styles.row}>
    <IconButton name="chevron-left" tone="plain" disabled={page === 0} onPress={() => onSelect(page - 1)} accessibilityLabel={`Página anterior de ${label}`} />
    <Text style={typography.labelOnNote} accessibilityLiveRegion="polite">{page + 1} / {count} · {total} {label}</Text>
    <IconButton name="chevron-right" tone="plain" disabled={page === count - 1} onPress={() => onSelect(page + 1)} accessibilityLabel={`Página siguiente de ${label}`} />
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 } });
