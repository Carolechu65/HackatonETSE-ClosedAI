import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { presentMemberCount } from '../../src/features/skeleton/model.ts';
import { useSkeleton } from '../../src/features/skeleton/store.tsx';
import {
  AnimatedIn,
  Avatar,
  Note,
  PressableScale,
  Screen,
  ScreenHeader,
  Toggle,
  colors,
  typography,
} from '../../src/ui/index.ts';

/** Piso: quién está, qué avisos acepta cada uno y qué falta del runtime nativo. */
export default function PisoRoute() {
  const { state, actions } = useSkeleton();
  const present = presentMemberCount(state);

  return (
    <Screen contentStyle={styles.page}>
      <ScreenHeader eyebrow="GENTE Y AVISOS" title="Piso" />

      <AnimatedIn>
        <Note index={2} wide label="En casa" title={`${present} de ${state.members.length} ahora`}>
          <View style={styles.members}>
            {state.members.map((member) => (
              <PressableScale
                key={member.id}
                onPress={() => actions.toggleMemberPresent(member.id)}
                accessibilityLabel={`${member.present ? 'Marcar fuera' : 'Marcar en casa'}: ${member.name}`}
                style={styles.member}
              >
                <Avatar initial={member.initial} filled={member.present} size={38} />
                <Text style={[typography.labelOnNote, !member.present && styles.absent]}>{member.name}</Text>
              </PressableScale>
            ))}
          </View>
        </Note>
      </AnimatedIn>

      <AnimatedIn delay={70}>
        <Note index={4} wide label="Avisos" title="Qué quieres recibir">
          <View style={styles.prefRow}>
            <View style={styles.prefText}>
              <Text style={typography.body}>Propuestas nuevas</Text>
              <Text style={typography.support}>Avisos de alarmas que te proponen.</Text>
            </View>
            <Toggle
              value={state.preferences.proposals}
              onToggle={() => actions.togglePreference('proposals')}
              accessibilityLabel="Avisos de propuestas nuevas"
            />
          </View>
          <View style={styles.prefRow}>
            <View style={styles.prefText}>
              <Text style={typography.body}>Recordatorios aceptados</Text>
              <Text style={typography.support}>Solo los que ya aceptaste tú.</Text>
            </View>
            <Toggle
              value={state.preferences.acceptedReminders}
              onToggle={() => actions.togglePreference('acceptedReminders')}
              accessibilityLabel="Avisos de recordatorios aceptados"
            />
          </View>
        </Note>
      </AnimatedIn>

      <AnimatedIn delay={130}>
        <Note index={5} wide label="Alarma sonora" title="Todavía no suena">
          <Text style={typography.support}>
            El recordatorio estándar ya se puede mostrar. La alarma audible con el proceso cerrado
            necesita el runtime Android; no se presenta como activa.
          </Text>
        </Note>
      </AnimatedIn>

      <AnimatedIn delay={170}>
        <Note index={1} wide label="Widget" title="Probar en el launcher">
          <Text style={typography.support}>
            Publica los estados de demostración en el widget de Android o míralos simulados en web.
          </Text>
          <Link href="/widget-lab" style={styles.link}>Abrir laboratorio del widget →</Link>
        </Note>
      </AnimatedIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 10,
    gap: 12,
  },
  members: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  member: {
    alignItems: 'center',
    gap: 4,
  },
  absent: {
    color: typography.labelOnNote.color,
    opacity: 0.6,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(43, 39, 35, 0.20)',
    paddingVertical: 2,
  },
  prefText: {
    flex: 1,
  },
  link: {
    ...typography.label,
    color: colors.ac,
    marginTop: 6,
  },
});
