import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { AnimatedIn, IconButton, Note, PrimaryAction, TextField, typography, tabularNums, colors } from '../../ui/index.ts';
import { Message, useAction } from '../../ui/Controls.tsx';
import { createIdGenerator } from '../../domain/ids.ts';
import { parseLocalDate } from '../../domain/time.ts';
import { expenseBalance, formatEuros, parseEuros, type Expense } from '../expenses/client.ts';
import { useExpenses } from '../expenses/useExpenses.ts';
import { Frame } from './Frame.tsx';
import { ListPages, useListPages } from './ListPages.tsx';
const ids = createIdGenerator();
const displayDate = (date: string) => date.split('-').reverse().join('/');

export function ProductExpenses() {
  const { state, client, memberName } = useProduct();
  const data = useExpenses();
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selection, setSelection] = useState<{ scope: string; excluded: string[] }>({ scope: '', excluded: [] });
  const [history, setHistory] = useState<{ scope: string; expanded: boolean }>({ scope: '', expanded: false });
  const [flash, setFlash] = useState<string | null>(null);
  const action = useAction();
  const operations = useRef<Record<string, string>>({});
  const uid = state.session?.userId ?? '';
  const scope = `${uid}:${state.groupId}`;
  const historyExpanded = history.scope === scope && history.expanded;
  const balance = expenseBalance(data.expenses, uid);
  const cents = parseEuros(amount);
  const live = state.session?.mode === 'live';
  const excluded = selection.scope === scope ? selection.excluded : [];
  const participants = state.members.filter(member => !excluded.includes(member.userId)).map(member => member.userId).sort();
  const validDate = !dueDate.trim() || !!parseLocalDate(dueDate.trim());
  const canSubmit = !action.busy && live && !!state.groupId && !!concept.trim() && cents !== null && participants.length > 0 && validDate;
  const pages = useListPages(data.expenses, scope, 3);
  const toggle = (memberUid: string) => {
    if (action.busy) return;
    setSelection({ scope, excluded: excluded.includes(memberUid) ? excluded.filter(id => id !== memberUid) : [...excluded, memberUid] });
  };
  const submit = () => void action.run(async () => {
    if (!canSubmit || !state.groupId || cents === null) return;
    const draft = { title: concept.trim(), amountCents: cents, participantUids: participants, ...(dueDate.trim() ? { dueDate: dueDate.trim() } : {}) };
    const key = JSON.stringify({ group: state.groupId, draft });
    operations.current[key] ??= ids.next('op');
    const expense = await client.finance.create(state.groupId, { ...draft, operationId: operations.current[key]! });
    pages.reveal(expense.id);
    setHistory({ scope, expanded: true });
    delete operations.current[key];
    setConcept(''); setAmount(''); setDueDate(''); setSelection({ scope, excluded: [] });
    setFlash(`Gasto añadido. Repartido entre ${participants.length} ${participants.length === 1 ? 'persona' : 'personas'}.`);
    await data.reload();
  });
  const settle = (expense: Expense) => void action.run(async () => {
    const key = `${expense.id}:${expense.version}:settle`;
    operations.current[key] ??= ids.next('op');
    await client.finance.settle(expense.groupId, expense.id, { expectedVersion: expense.version, operationId: operations.current[key]! });
    setFlash('Tu parte figura como pagada. No se ha realizado una transferencia.');
    await data.reload();
  });
  return <Frame title="Gastos" eyebrow="CUENTAS DEL PISO">
    <AnimatedIn><Note index={1} wide label="Pendiente de pagar" title="Te deben">
      <Text style={[typography.amount, tabularNums]}>{data.loaded ? formatEuros(balance.owed) : '—'}</Text>
      <Text style={typography.support}>{data.loaded ? `Debes ${formatEuros(balance.owes)} · ${state.members.length} personas en el piso` : 'Conecta tu cuenta y selecciona un piso para ver tus cuentas.'}</Text>
    </Note></AnimatedIn>
    <AnimatedIn delay={80}><Note index={3} wide label="Movimientos" title="Últimos gastos">
      <Text style={typography.support}>{data.loaded ? `${data.expenses.length} ${data.expenses.length === 1 ? 'gasto registrado' : 'gastos registrados'}` : 'Los gastos se muestran al conectar tu cuenta.'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={historyExpanded ? 'Ocultar historial de gastos' : 'Mostrar historial de gastos'} accessibilityState={{ expanded: historyExpanded }} aria-expanded={historyExpanded} onPress={() => setHistory({ scope, expanded: !historyExpanded })} style={styles.historyToggle}>
        <Text style={[typography.bodyStrong, { flex: 1 }]}>{historyExpanded ? 'Ocultar historial de gastos' : 'Mostrar historial de gastos'}</Text><Text style={typography.body}>{historyExpanded ? '▴' : '▾'}</Text>
      </Pressable>
      {historyExpanded ? <View>
      {pages.items.map(expense => {
        const share = expense.shares.find(s => s.uid === uid);
        const settled = expense.settledUids.includes(uid);
        const canSettle = !!share && !settled && expense.paidByUid !== uid;
        return <View key={expense.id} style={styles.expense}>
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={typography.body} numberOfLines={2}>{expense.title}</Text><Text style={typography.support}>Pagó {memberName(expense.paidByUid)}{share ? ` · tu parte ${formatEuros(share.amountCents)}` : ''}</Text></View>
            <Text style={[typography.bodyStrong, tabularNums]}>{formatEuros(expense.amountCents)}</Text>
            {canSettle ? <IconButton name="check" tone="plain" disabled={action.busy} onPress={() => settle(expense)} accessibilityLabel={`Marcar pagada mi parte de ${expense.title}`} /> : <Text style={typography.labelOnNote}>{expense.paidByUid === uid ? 'Pagaste' : settled ? 'Pagado' : 'Sin parte'}</Text>}
          </View>
          <Text style={typography.support}>{expense.dueDate ? `Fecha límite: ${displayDate(expense.dueDate)}` : 'Sin fecha límite'}</Text>
          {expense.shares.map(part => <Text key={part.uid} style={typography.support}>{memberName(part.uid)} · {formatEuros(part.amountCents)} · {part.uid === expense.paidByUid ? 'Parte propia' : expense.settledUids.includes(part.uid) ? 'Pagado' : 'Pendiente'}</Text>)}
        </View>;
      })}
      {!data.expenses.length ? <Text style={typography.support}>{data.loaded ? 'No hay gastos todavía.' : 'Los gastos se muestran al conectar tu cuenta.'}</Text> : null}
      <ListPages page={pages.page} count={pages.count} total={data.expenses.length} label="gastos" onSelect={pages.select} />
      </View> : null}
    </Note></AnimatedIn>
    <AnimatedIn delay={120}><Note index={4} wide label="Compartir un gasto" title="Añadir un gasto">
      <View style={styles.form}>
        <View style={styles.addRow}><TextField value={concept} onChangeText={setConcept} placeholder="Concepto" maxLength={120} style={{ flex: 1, minWidth: 0 }} /><TextField value={amount} onChangeText={setAmount} placeholder="0,00" keyboardType="decimal-pad" maxLength={10} accessibilityLabel="Importe en euros" style={{ width: 78, textAlign: 'right' }} /></View>
        <Text style={typography.bodyStrong}>¿Quién comparte este gasto?</Text>
        <Text style={typography.support}>Elige quién te debe su parte. Inclúyete si también te corresponde pagar.</Text>
        {state.members.map(member => {
          const selected = participants.includes(member.userId);
          const index = participants.indexOf(member.userId);
          const preview = selected && cents !== null ? Math.floor(cents / participants.length) + (index < cents % participants.length ? 1 : 0) : null;
          return <Pressable key={member.userId} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: action.busy }} disabled={action.busy} accessibilityLabel={`Incluir a ${member.displayName} en el reparto`} onPress={() => toggle(member.userId)} style={styles.participant}>
            <Text style={typography.body}>{selected ? '☑' : '☐'}</Text><Text style={[typography.body, { flex: 1 }]}>{member.displayName}{member.userId === uid ? ' · Tú' : ''}</Text>{preview !== null ? <Text style={[typography.support, tabularNums]}>{formatEuros(preview)}</Text> : null}
          </Pressable>;
        })}
        {!participants.length ? <Text style={typography.support}>Selecciona al menos una persona.</Text> : null}
        <Text style={typography.bodyStrong}>Fecha límite de pago (opcional)</Text>
        <TextField value={dueDate} onChangeText={setDueDate} placeholder="AAAA-MM-DD" maxLength={10} accessibilityLabel="Fecha límite de pago, año-mes-día" />
        {!validDate ? <Text style={typography.support}>Escribe una fecha válida, por ejemplo 2026-12-31.</Text> : null}
        <PrimaryAction label={action.busy ? 'Guardando…' : 'Añadir gasto'} onPress={submit} disabled={!canSubmit} />
      </View>
    </Note></AnimatedIn>
    <Message text={action.error ?? data.error} error /><Message text={flash} />
    {data.error || action.error ? <IconButton name="refresh-cw" tone="plain" disabled={action.busy} onPress={() => { action.setError(null); void data.reload(); }} accessibilityLabel="Reintentar cargar gastos" /> : null}
    <Text style={[typography.label, { marginTop: 'auto' }]}>{amount && cents === null ? 'Escribe un importe como 12,50.' : 'Reparto igual entre las personas elegidas. La marca de pago registra tu parte; no mueve dinero.'}</Text>
  </Frame>;
}
const styles = StyleSheet.create({
  expense: { gap: 4, borderBottomWidth: 1, borderBottomColor: colors.noteLine, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  form: { gap: 10 },
  historyToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8 },
  participant: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
});
