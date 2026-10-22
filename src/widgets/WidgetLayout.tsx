import { Button, Column, LazyColumn, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, fillMaxWidth, padding, size } from '@expo/ui/jetpack-compose/modifiers';
import type { AlarmaTWidgetProps } from './viewModel.ts';
import { widgetColors } from './palette.ts';

export type WidgetVariant = 'board' | 'alarms' | 'tasks';
export type NativeWidgetProps = AlarmaTWidgetProps & { readonly variant: WidgetVariant };

/** Only serializable props enter the isolated widget runtime. Each direct child
 * of LazyColumn becomes a scrollable Glance list item; no JS callbacks are used. */
export function WidgetLayout(props: NativeWidgetProps) {
  'widget';
  // Installed providers can retain pre-upgrade props until the app next publishes.
  const palette = props.colors ?? {
    wall: '#efe2c4', paper: '#f5df9a', taskPaper: '#bfe0cf', ink: '#2b2723', muted: '#6a5c48', accent: '#bf3a2f',
    papers: ['#f5df9a', '#bfe0cf', '#f2b8b0', '#bcd6e6', '#f7f0e1', '#e9c9a7'],
    magnets: ['#d9473b', '#2f7d6d', '#e8a33a', '#3c6ea8', '#d9473b', '#2f7d6d'],
  };
  const tasks = props.tasks ?? [];
  const variant = props.variant ?? 'board';
  const showAlarms = variant !== 'tasks';
  const showTasks = variant !== 'alarms';
  return (
    <LazyColumn modifiers={[fillMaxSize(), background(palette.wall), padding(12, 10, 12, 10)]}>
      <Column modifiers={[fillMaxWidth(), padding(0, 0, 0, 10)]} verticalArrangement={{ spacedBy: 4 }}>
        <Row horizontalArrangement="spaceBetween" modifiers={[fillMaxWidth()]}>
          <Text color={palette.muted} maxLines={1} style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: 1.2 }}>ALARMAT</Text>
          <Text color={palette.muted} maxLines={1} style={{ fontSize: 9 }}>{props.stale ? 'REVISAR DATOS' : 'TU PISO'}</Text>
        </Row>
        <Text color={palette.ink} style={{ fontFamily: 'serif', fontSize: 22 }}>{variant === 'alarms' ? 'Tus alarmas' : variant === 'tasks' ? 'Tus tareas' : 'El tablón'}</Text>
        <Text color={palette.muted} maxLines={2} style={{ fontSize: 10 }}>{props.signedIn ? (showTasks ? (props.taskSummary ?? 'Abre AlarmaT para actualizar tus tareas') : props.pending) : 'Abre AlarmaT e inicia sesión'}</Text>
      </Column>
      {showAlarms ? (
        <Column modifiers={[fillMaxWidth(), padding(0, 0, 0, 9)]}>
          <Button {...{ target: props.alarmUrl ?? props.inboxUrl }} colors={{ containerColor: palette.paper, contentColor: palette.ink }} modifiers={[fillMaxWidth(), cornerRadius(3)]} contentPadding={{ start: 12, top: 10, end: 12, bottom: 12 }}>
            <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 5 }}>
              <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 7 }}>
                <Spacer modifiers={[size(9, 9), background(palette.accent), cornerRadius(5)]} />
                <Text color={palette.ink} style={{ fontFamily: 'monospace', fontSize: 8, letterSpacing: 0.8 }}>PRÓXIMA ALARMA</Text>
              </Row>
              <Text color={palette.ink} maxLines={3} overflow="ellipsis" style={{ fontFamily: 'serif', fontSize: 18 }}>{props.headline}</Text>
              <Text color={palette.ink} maxLines={2} style={{ fontSize: 11 }}>{props.when || props.emptyBody}</Text>
              <Text color={palette.ink} maxLines={1} style={{ fontSize: 9 }}>{props.alarmUrl ? 'Toca para ver la alarma →' : 'Abrir AlarmaT →'}</Text>
            </Column>
          </Button>
        </Column>
      ) : null}
      {showAlarms && props.signedIn ? <Text color={palette.muted} maxLines={3} style={{ fontSize: 10 }} modifiers={[padding(0, 0, 0, 10)]}>{props.pending}</Text> : null}
      {showTasks && tasks.length > 0 ? <Text color={palette.muted} style={{ fontFamily: 'monospace', fontSize: 9 }} modifiers={[padding(0, 0, 0, 8)]}>CHECKLIST · DESLIZA PARA VER MÁS</Text> : null}
      {showTasks ? tasks.map((task, index) => (
        <Column key={task.id} modifiers={[fillMaxWidth(), padding(0, 0, 0, 9)]}>
          <Button {...{ target: task.url }} colors={{ containerColor: palette.papers[(index + 1) % palette.papers.length], contentColor: palette.ink }} modifiers={[fillMaxWidth(), cornerRadius(3)]} contentPadding={{ start: 12, top: 10, end: 12, bottom: 12 }}>
            <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 5 }}>
              <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 7 }}>
                <Spacer modifiers={[size(9, 9), background(palette.magnets[(index + 1) % palette.magnets.length] ?? palette.accent), cornerRadius(5)]} />
                <Text color={palette.ink} style={{ fontFamily: 'monospace', fontSize: 8, letterSpacing: 0.8 }}>{task.completed ? 'HECHA' : 'POR HACER'}</Text>
              </Row>
              <Text color={palette.ink} maxLines={3} overflow="ellipsis" style={{ fontFamily: 'serif', fontSize: 17 }}>{`${task.completed ? '☑' : '☐'} ${task.title}`}</Text>
              <Text color={palette.ink} maxLines={2} style={{ fontSize: 10 }}>{task.detail}</Text>
              <Text color={palette.ink} style={{ fontSize: 9 }}>Ver tarea →</Text>
            </Column>
          </Button>
          {task.actionTarget ? <Button {...{ target: task.actionTarget }} colors={{ containerColor: palette.accent, contentColor: '#fff6ec' }} modifiers={[fillMaxWidth()]}>{task.completed ? '☑ Volver a pendiente' : '☐ Marcar hecha'}</Button> : null}
        </Column>
      )) : null}
      {showTasks && tasks.length === 0 ? (
        <Column modifiers={[fillMaxWidth(), background(palette.taskPaper), padding(12, 12, 12, 12)]} verticalArrangement={{ spacedBy: 5 }}>
          <Text color={palette.ink} style={{ fontFamily: 'serif', fontSize: 17 }}>{props.signedIn && props.tasks ? 'Todo al día' : 'Tus tareas, aquí'}</Text>
          <Text color={palette.ink} style={{ fontSize: 11 }}>{props.signedIn && props.tasks ? 'No hay tareas pendientes en este piso.' : 'Abre AlarmaT para ver las tareas de tu piso.'}</Text>
        </Column>
      ) : null}
      <Column modifiers={[fillMaxWidth(), padding(0, 10, 0, 0)]} verticalArrangement={{ spacedBy: 5 }}>
        <Button {...{ target: showTasks && props.signedIn ? (props.tasksUrl ?? 'alarmat://tasks') : props.inboxUrl }} colors={{ containerColor: palette.accent, contentColor: '#fff6ec' }} modifiers={[fillMaxWidth()]}>{props.signedIn ? (showTasks ? 'Ver todas las tareas' : 'Ver propuestas') : 'Abrir AlarmaT'}</Button>
        <Text color={palette.muted} maxLines={2} style={{ fontSize: 9 }}>{props.updated}</Text>
      </Column>
    </LazyColumn>
  );
}

export const initialWidgetProps: AlarmaTWidgetProps = {
  signedIn: false, headline: 'Abre AlarmaT', when: '', pending: 'Sin sesión', updated: 'Sin datos',
  freshness: 'ahora', stale: false, emptyBody: 'Inicia sesión para ver tus alarmas.',
  inboxUrl: 'alarmat:///', alarmUrl: null, tasks: [], taskSummary: 'Sin tareas disponibles',
  taskCount: 0, tasksUrl: 'alarmat://tasks', colors: widgetColors,
};
