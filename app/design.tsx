import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import {
  PrimaryAction,
  Screen,
  ScreenHeader,
  Sheet,
  Note,
  colors,
  layout,
  noteStyleFor,
  tabularNums,
  typography,
} from '../src/ui/index.ts';

/**
 * Catálogo de componentes de «Nevera Retro» (P1).
 *
 * No es una pantalla de producto: sirve como referencia viva para P2 y P6.
 * Ningún botón guarda datos; las acciones reales viven en `src/features`.
 */
export default function DesignCatalogRoute() {
  const tablon = noteStyleFor(0);
  const gasto = noteStyleFor(1);
  const compra = noteStyleFor(2);
  const aviso = noteStyleFor(3);
  const tarea = noteStyleFor(4);
  const plan = noteStyleFor(5);

  return (
    <Screen scroll contentStyle={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader eyebrow="LA PUERTA DE LA NEVERA" title="Tablón" />

      <View style={styles.tabs}>
        <Text style={typography.tabActive}>Tablón</Text>
        <Text style={typography.tab}>Gastos</Text>
        <Text style={typography.tab}>Tareas</Text>
        <Text style={typography.tab}>Piso</Text>
      </View>

      <Note index={0} label="Limpieza" title="Turnos de noviembre" wide>
        <View style={styles.table}>
          <Row left="Cocina" right="Dani" />
          <Row left="Baño" right="Lucía" />
          <Row left="Salón" right="Tú" />
        </View>
      </Note>

      <View style={styles.board}>
        <View style={styles.column}>
          <Note index={1} label="Gasto · ayer" title="Factura de la luz">
            <Text style={[typography.amount, tabularNums]}>84,20 €</Text>
            <Text style={typography.support}>21,05 € cada uno · sept y oct</Text>
          </Note>
        </View>
        <View style={styles.column}>
          <Note index={2} label="Compra" title="Lo que falta en casa">
            <ChecklistItem label="Aceite" done />
            <ChecklistItem label="Papel de cocina" />
            <ChecklistItem label="Detergente" />
          </Note>
        </View>
      </View>

      <Note index={3} label="Aviso · martes" title="El casero viene el martes">
        <Text style={typography.support}>Sube a las 10:00 y trae la llave del cuarto.</Text>
      </Note>

      <View style={styles.board}>
        <View style={styles.column}>
          <Note index={4} label="Tarea · hoy" title="Bajar el reciclaje">
            <Text style={typography.support}>Te toca a ti · antes de las 22:00</Text>
            <ProgressBar value={2} total={3} />
          </Note>
        </View>
        <View style={styles.column}>
          <Note index={5} label="Plan · viernes" title="Cena en casa">
            <View style={styles.avatars}>
              <Avatar initial="L" filled />
              <Avatar initial="A" filled />
              <Avatar initial="D" filled />
              <Avatar initial="C" />
            </View>
            <Text style={typography.support}>3 de 4 van</Text>
          </Note>
        </View>
      </View>

      <Text style={styles.caption}>Detalle y formularios van sobre una hoja grande: menta y imán rojo.</Text>

      <Sheet>
        <Text style={typography.labelOnNote}>Gasto · suministros</Text>
        <Text style={typography.detailTitle}>Factura de la luz</Text>
        <Text style={[styles.bigAmount, tabularNums]}>84,20 €</Text>

        <View style={styles.definitions}>
          <DefinitionRow term="Pagó" value="Luis" />
          <DefinitionRow term="Fecha" value="21 oct · 21:40" />
          <DefinitionRow term="Periodo" value="sept y oct" />
          <DefinitionRow term="Reparto" value="4 partes iguales" />
        </View>

        <Text style={typography.labelOnNote}>Quién debe qué</Text>
        <View style={styles.debtRow}>
          <Avatar initial="A" filled />
          <Text style={styles.debtName}>Ana</Text>
          <Text style={typography.labelOnNote}>Pendiente</Text>
          <Text style={[styles.debtAmount, tabularNums]}>21,05 €</Text>
        </View>
        <View style={styles.debtRow}>
          <Avatar initial="D" filled />
          <Text style={styles.debtName}>Dani</Text>
          <Text style={typography.labelOnNote}>Pagado el 22 oct</Text>
          <Text style={[styles.debtAmount, styles.debtPaid, tabularNums]}>21,05 €</Text>
        </View>
        <Text style={styles.quote}>«Yo ya he puesto la lavadora, esta la pago yo.»</Text>
      </Sheet>

      <PrimaryAction label="Marcar mi parte como pagada" onPress={() => undefined} />

      <Text style={styles.caption}>
        Catálogo de componentes de P1. Los botones no guardan nada; la pantalla real del tablón la
        implementa P2 con estos mismos primitivos.
      </Text>
    </Screen>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <View style={styles.row}>
      <Text style={typography.body}>{left}</Text>
      <Text style={[styles.rowRight, tabularNums]}>{right}</Text>
    </View>
  );
}

function ChecklistItem({ label, done = false }: { label: string; done?: boolean }) {
  return (
    <View style={styles.checkRow}>
      <View style={[styles.checkBox, done && styles.checkBoxDone]} />
      <Text style={[typography.body, done && styles.checkDone]}>{label}</Text>
    </View>
  );
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const ratio = Math.max(0, Math.min(1, value / total));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { flex: ratio }]} />
      <View style={{ flex: 1 - ratio }} />
    </View>
  );
}

function Avatar({ initial, filled = false }: { initial: string; filled?: boolean }) {
  return (
    <View style={[styles.avatar, filled && styles.avatarFilled]}>
      <Text style={[styles.avatarText, filled && styles.avatarTextFilled]}>{initial}</Text>
    </View>
  );
}

function DefinitionRow({ term, value }: { term: string; value: string }) {
  return (
    <View style={styles.definitionRow}>
      <Text style={typography.labelOnNote}>{term}</Text>
      <Text style={typography.body}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  tabs: {
    flexDirection: 'row',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.ln,
    paddingBottom: 10,
    marginBottom: 4,
  },
  board: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: layout.noteGapColumn,
  },
  column: {
    flex: 1,
  },
  table: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: colors.noteLine,
    paddingVertical: 3,
  },
  rowRight: {
    ...typography.body,
    marginLeft: 'auto',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 2,
  },
  checkBox: {
    width: 11,
    height: 11,
    borderWidth: 1,
    borderColor: colors.ntx,
  },
  checkBoxDone: {
    backgroundColor: colors.ntx,
  },
  checkDone: {
    color: colors.noteLabel,
    textDecorationLine: 'line-through',
  },
  avatars: {
    flexDirection: 'row',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.ntx,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -5,
    backgroundColor: 'transparent',
  },
  avatarFilled: {
    backgroundColor: colors.ntx,
  },
  avatarText: {
    ...typography.labelOnNote,
    letterSpacing: 0,
    color: colors.ntx,
  },
  avatarTextFilled: {
    color: colors.onAvatar,
  },
  track: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.noteTrack,
    overflow: 'hidden',
    marginTop: 4,
  },
  fill: {
    backgroundColor: colors.ntx,
  },
  caption: {
    ...typography.label,
    color: colors.mu,
  },
  bigAmount: {
    ...typography.amount,
    fontSize: 64,
    lineHeight: 64 * 0.9,
  },
  definitions: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.noteLine,
    paddingVertical: 4,
    gap: 2,
  },
  definitionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 2,
  },
  debtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.noteLine,
    paddingVertical: 5,
  },
  debtName: {
    ...typography.body,
    flex: 1,
  },
  debtAmount: {
    ...typography.body,
  },
  debtPaid: {
    color: colors.noteLabel,
  },
  quote: {
    fontFamily: typography.noteTitle.fontFamily,
    fontSize: 17,
    lineHeight: 17 * 1.2,
    color: colors.ntx,
  },
});
