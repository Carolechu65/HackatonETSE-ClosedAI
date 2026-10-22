import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { typography } from '../ui/index.ts';
import type { AlarmaTWidgetProps } from './viewModel.ts';

export type WidgetVariant = 'board' | 'alarms' | 'tasks';
export type WidgetPreviewProps = {
  props: AlarmaTWidgetProps;
  variant?: WidgetVariant;
  width?: number;
};

/** Scrollable launcher simulation; uses exactly the published widget palette and data. */
export function WidgetPreview({ props, variant = 'board', width = 320 }: WidgetPreviewProps) {
  const palette = props.colors;
  const [expanded, setExpanded] = useState(false);
  const showTasks = variant !== 'alarms';
  const showAlarms = variant !== 'tasks';
  return (
    <View style={styles.launcher}>
      <View style={[styles.widget, { width, maxWidth: '100%', backgroundColor: palette.wall }]}>
        <ScrollView style={{ height: expanded ? 560 : 360 }} contentContainerStyle={styles.content} nestedScrollEnabled accessibilityLabel={`Widget ${variant === 'board' ? 'tablón' : variant === 'tasks' ? 'tareas' : 'alarmas'}`}>
          <View style={styles.topRow}>
            <Text style={[styles.eyebrow, { color: palette.muted }]}>ALARMAT</Text>
            <Text style={[styles.eyebrow, { color: palette.muted }]}>{props.stale ? 'REVISAR DATOS' : 'TU PISO'}</Text>
          </View>
          <Text style={[styles.title, { color: palette.ink }]}>{variant === 'board' ? 'El tablón' : variant === 'tasks' ? 'Tus tareas' : 'Tus alarmas'}</Text>
          <Text style={[styles.support, { color: palette.muted }]}>{props.signedIn ? (showTasks ? props.taskSummary : props.pending) : 'Abre AlarmaT e inicia sesión'}</Text>
          {showAlarms ? <View style={[styles.paper, { backgroundColor: palette.paper }]}>
            <View style={styles.noteTop}><View style={[styles.magnet, { backgroundColor: palette.accent }]} /><Text style={[styles.noteLabel, { color: palette.ink }]}>PRÓXIMA ALARMA</Text></View>
            <Text numberOfLines={3} style={[styles.headline, { color: palette.ink }]}>{props.headline}</Text>
            <Text style={[styles.support, { color: palette.ink }]}>{props.when || props.emptyBody}</Text>
            <Text style={[styles.link, { color: palette.ink }]}>{props.alarmUrl ? 'Toca para ver la alarma →' : 'Abrir AlarmaT →'}</Text>
          </View> : null}
          {showAlarms && props.signedIn ? <Text style={[styles.support, { color: palette.muted }]}>{props.pending}</Text> : null}
          {showTasks && props.tasks.length > 0 ? <Text style={[styles.eyebrow, { color: palette.muted }]}>CHECKLIST · DESLIZA PARA VER MÁS</Text> : null}
          {showTasks ? props.tasks.map((task, index) => <View key={task.id} style={[styles.paper, { backgroundColor: palette.papers[(index + 1) % palette.papers.length] }]}>
            <View style={styles.noteTop}><View style={[styles.magnet, { backgroundColor: palette.magnets[(index + 1) % palette.magnets.length] }]} /><Text style={[styles.noteLabel, { color: palette.ink }]}>{task.completed ? 'HECHA' : 'POR HACER'}</Text></View>
            <View style={styles.taskTitle}>
              <View accessibilityLabel={task.completed ? 'Hecha' : 'Pendiente'} style={[styles.checkbox, { borderColor: palette.ink, backgroundColor: task.completed ? palette.accent : 'transparent' }]}><Text style={styles.checkmark}>{task.completed ? '✓' : ''}</Text></View>
              <Text numberOfLines={3} style={[styles.headline, { color: palette.ink, flex: 1, textDecorationLine: task.completed ? 'line-through' : 'none' }]}>{task.title}</Text>
            </View>
            <Text style={[styles.support, { color: palette.ink }]}>{task.detail}</Text>
            <Text style={[styles.link, { color: palette.ink }]}>Ver tarea →</Text>
            {task.actionTarget ? <View style={[styles.checkAction, { backgroundColor: palette.accent }]}><Text style={styles.openText}>{task.completed ? '☑ Volver a pendiente' : '☐ Marcar hecha'}</Text></View> : null}
          </View>) : null}
          {showTasks && props.tasks.length === 0 ? <View style={[styles.paper, { backgroundColor: palette.taskPaper }]}>
            <Text style={[styles.headline, { color: palette.ink }]}>{props.signedIn ? 'Todo al día' : 'Tus tareas, aquí'}</Text>
            <Text style={[styles.support, { color: palette.ink }]}>{props.signedIn ? 'No hay tareas pendientes en este piso.' : 'Inicia sesión para ver las tareas de tu piso.'}</Text>
          </View> : null}
          <View style={[styles.open, { backgroundColor: palette.accent }]}><Text style={styles.openText}>{props.signedIn ? (showTasks ? 'Ver todas las tareas' : 'Ver propuestas') : 'Abrir AlarmaT'}</Text></View>
          <Text style={[styles.support, { color: palette.muted }]}>{props.updated}</Text>
        </ScrollView>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.expand}>
        <Text style={styles.expandText}>{expanded ? 'Reducir vista ↑' : 'Ampliar vista ↓'}</Text>
      </Pressable>
    </View>
  );
}


const styles = StyleSheet.create({
  launcher: { backgroundColor: '#272a29', borderRadius: 12, paddingVertical: 20, paddingHorizontal: 12, alignItems: 'center', gap: 12 },
  widget: { borderRadius: 5, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' },
  content: { padding: 14, gap: 10 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { ...typography.label, fontSize: 9, letterSpacing: 1 },
  title: { fontFamily: typography.noteTitle.fontFamily, fontSize: 26, lineHeight: 30 },
  paper: { borderRadius: 3, padding: 12, gap: 6, boxShadow: '0 2px 4px rgba(40,30,20,0.15)' },
  taskTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  checkbox: { width: 20, height: 20, marginTop: 2, borderWidth: 2, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff6ec', fontSize: 15, lineHeight: 16 },
  noteTop: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  noteLabel: { ...typography.label, fontSize: 8, letterSpacing: 0.8 },
  magnet: { width: 9, height: 9, borderRadius: 5, boxShadow: '0 1px 2px rgba(0,0,0,0.3)' },
  headline: { fontFamily: typography.noteTitle.fontFamily, fontSize: 20, lineHeight: 24 },
  support: { ...typography.support, fontSize: 11, lineHeight: 15 },
  link: { ...typography.support, fontSize: 10 },
  checkAction: { minHeight: 36, padding: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 2, marginTop: 3 },
  open: { padding: 12, alignItems: 'center', borderRadius: 3 },
  openText: { ...typography.label, color: '#fff6ec', fontSize: 10 },
  expand: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 20 },
  expandText: { ...typography.support, color: '#fff6ec' },
});
