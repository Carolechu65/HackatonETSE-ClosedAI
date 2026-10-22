import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ExpenseRow } from '../../src/features/skeleton/components.tsx';
import {
  formatEuros,
  parseEuros,
  perPersonCents,
  presentMemberCount,
  settledTotalCents,
  unsettledTotalCents,
} from '../../src/features/skeleton/model.ts';
import { useSkeleton } from '../../src/features/skeleton/store.tsx';
import {
  AnimatedIn,
  FlashMessage,
  IconButton,
  Note,
  Screen,
  ScreenHeader,
  TextField,
  tabularNums,
  typography,
} from '../../src/ui/index.ts';

/** Gastos: saldo pendiente, marcar pagado y añadir un gasto sin abrir otra pantalla. */
export default function GastosRoute() {
  const { state, actions } = useSkeleton();
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const pendingTotal = unsettledTotalCents(state);
  const paidTotal = settledTotalCents(state);
  const people = presentMemberCount(state);
  const amountCents = parseEuros(amount);
  const canAdd = concept.trim().length > 0 && amountCents !== null;

  const submit = () => {
    if (!canAdd || amountCents === null) return;
    actions.addExpense(concept, amountCents);
    setConcept('');
    setAmount('');
    setFlash({ id: Date.now(), text: 'Gasto añadido' });
  };

  return (
    <Screen contentStyle={styles.page}>
      <ScreenHeader eyebrow="CUENTAS DEL PISO" title="Gastos" />

      <AnimatedIn>
        <Note index={1} wide label="Pendiente de pagar" title="Te deben">
          <Text style={[typography.amount, tabularNums]}>{formatEuros(pendingTotal)}</Text>
          <Text style={typography.support}>
            {formatEuros(perPersonCents(state))} por persona · {people} en casa · {formatEuros(paidTotal)} ya pagado
          </Text>
        </Note>
      </AnimatedIn>

      <AnimatedIn delay={80}>
        <Note index={3} wide label="Movimientos" title="Últimos gastos" style={styles.note}>
          {state.expenses.slice(0, 3).map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              onToggleSettled={() => {
                actions.toggleExpenseSettled(expense.id);
                setFlash({
                  id: Date.now(),
                  text: expense.settled ? 'Vuelve a pendiente' : 'Marcado como pagado',
                });
              }}
            />
          ))}

          <View style={styles.addRow}>
            <TextField
              value={concept}
              onChangeText={setConcept}
              placeholder="Concepto"
              maxLength={40}
              style={styles.concept}
            />
            <TextField
              value={amount}
              onChangeText={setAmount}
              placeholder="0,00"
              keyboardType="decimal-pad"
              maxLength={10}
              accessibilityLabel="Importe en euros"
              style={styles.amount}
            />
            <IconButton name="plus" onPress={submit} disabled={!canAdd} accessibilityLabel="Añadir gasto" />
          </View>
        </Note>
      </AnimatedIn>

      <FlashMessage key={flash?.id ?? 'idle'} message={flash?.text ?? null} />

      <Text style={[styles.hint, tabularNums]}>
        {amount.length > 0 && amountCents === null
          ? 'Escribe un importe en euros, por ejemplo 12,50.'
          : 'Toca Pagar para liquidar tu parte. Solo es una vista de ejemplo.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 4,
    gap: 12,
  },
  note: {
    flexShrink: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  concept: {
    flex: 1,
  },
  amount: {
    width: 78,
    textAlign: 'right',
  },
  hint: {
    ...typography.label,
    marginTop: 'auto',
  },
});
