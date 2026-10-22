import { TicketPreview } from '../expenses/TicketPreview.tsx';
import { ExpenseForm } from '../expenses/ExpenseForm.tsx';
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
  const [editing,setEditing]=useState<Expense|undefined>();
  const [formVersion,setFormVersion]=useState(0);
  const [history, setHistory] = useState<{ scope: string; expanded: boolean }>({ scope: '', expanded: false });
  const [flash, setFlash] = useState<string | null>(null);
  const action = useAction();
  const operations = useRef<Record<string, string>>({});
  const uid = state.session?.userId ?? '';
  const scope = `${uid}:${state.groupId}`;
  const historyExpanded = history.scope === scope && history.expanded;
  const balance = expenseBalance(data.expenses, uid);
  const pages = useListPages(data.expenses, scope, 3);
  const saved=async(expense:Expense)=>{pages.reveal(expense.id);setHistory({scope,expanded:true});setEditing(undefined);setFormVersion(v=>v+1);setFlash('Gasto guardado con el reparto elegido.');await data.reload();};
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
          {expense.purchasedOn?<Text style={typography.support}>Compra: {displayDate(expense.purchasedOn)}{expense.merchant?` · ${expense.merchant}`:''}</Text>:null}
          {expense.receiptId?<TicketPreview groupId={expense.groupId} receiptId={expense.receiptId}/>:null}
          {expense.category?<Text style={typography.support}>{expense.category}</Text>:null}
          {expense.paidByUid===uid&&!expense.settledUids.some(id=>id!==uid&&(expense.shares.find(s=>s.uid===id)?.amountCents??0)>0)?<Pressable accessibilityRole="button" onPress={()=>setEditing(expense)} style={{paddingVertical:10}}><Text style={typography.body}>Editar gasto{expense.receiptId?' y ver ticket':''}</Text></Pressable>:null}
          <Text style={typography.support}>{expense.dueDate ? `Fecha límite: ${displayDate(expense.dueDate)}` : 'Sin fecha límite'}</Text>
          {expense.shares.map(part => <Text key={part.uid} style={typography.support}>{memberName(part.uid)} · {formatEuros(part.amountCents)} · {part.uid === expense.paidByUid ? 'Parte propia' : expense.settledUids.includes(part.uid) ? 'Pagado' : 'Pendiente'}</Text>)}
        </View>;
      })}
      {!data.expenses.length ? <Text style={typography.support}>{data.loaded ? 'No hay gastos todavía.' : 'Los gastos se muestran al conectar tu cuenta.'}</Text> : null}
      <ListPages page={pages.page} count={pages.count} total={data.expenses.length} label="gastos" onSelect={pages.select} />
      </View> : null}
    </Note></AnimatedIn>
    <AnimatedIn delay={120}><Note index={4} wide label="Compartir un gasto" title={editing?.groupId===state.groupId?'Editar gasto':'Añadir un gasto'}>
      <ExpenseForm key={`${scope}:${editing?.groupId===state.groupId?editing.id:'new'}:${formVersion}`} expense={editing?.groupId===state.groupId?editing:undefined} onSaved={saved} onCancel={()=>setEditing(undefined)}/>
    </Note></AnimatedIn>
    <Message text={action.error ?? data.error} error /><Message text={flash} />
    {data.error || action.error ? <IconButton name="refresh-cw" tone="plain" disabled={action.busy} onPress={() => { action.setError(null); void data.reload(); }} accessibilityLabel="Reintentar cargar gastos" /> : null}
    <Text style={[typography.label, {marginTop:'auto'}]}>La marca de pago registra tu parte; no mueve dinero.</Text>
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
