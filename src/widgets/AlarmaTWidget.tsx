import { Button, Column, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxWidth, height, padding, size, wrapContentHeight } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';
import type { AlarmaTWidgetProps } from './viewModel.ts';

/**
 * P6 · Plantilla del widget Android (expo-widgets, Jetpack Compose Glance).
 *
 * Restricciones del runtime aislado que esta plantilla respeta:
 * - No usa hooks, estado, `Intl`, fechas ni promesas: todo llega ya formateado en props.
 * - No importa datos de la app ni consulta SQLite/Firebase. Solo pinta `AlarmaTWidgetProps`.
 * - Solo usa componentes y modificadores soportados en Android. En esta versión
 *   `weight()` no está en la lista soportada, así que las alturas son fijas.
 *
 * Estilo: «Nevera Retro» (`nevera-retro.md` §5): puerta crema, nota de papel con
 * imán rojo, serif para el título y mono para datos. Los colores van literales
 * porque el bundle no puede referenciar constantes del módulo.
 *
 * Los targets de apertura pasan al PendingIntent del config plugin
 * with-widget-links. No hay callback JS ni mutación desde el launcher.
 */
function AlarmaTWidget(props: AlarmaTWidgetProps) {
  'widget';

  const wall = '#efe2c4';
  const paper = '#f5df9a';
  const ink = '#2b2723';
  const muted = '#6a5c48';
  const magnet = '#d9473b';

  return (
    <Column
      verticalArrangement={{ spacedBy: 5 }}
      modifiers={[
        fillMaxWidth(),
        wrapContentHeight(),
        background(wall),
        padding(14, 10, 14, 10),
        cornerRadius(2),
      ]}
    >
      <Row horizontalArrangement="spaceBetween" verticalAlignment="center" modifiers={[fillMaxWidth()]}>
        <Text
          color={muted}
          maxLines={1}
          style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: 1.4 }}
        >
          ALARMAT
        </Text>
        <Text
          color={muted}
          maxLines={1}
          style={{ fontFamily: 'monospace', fontSize: 8, letterSpacing: 0.6 }}
        >
          {props.stale ? 'REVISAR DATOS' : 'ÚLTIMA LECTURA'}
        </Text>
      </Row>

      <Row
        horizontalArrangement={{ spacedBy: 8 }}
        verticalAlignment="top"
        modifiers={[
          fillMaxWidth(),
          height(66),
          background(paper),
          padding(11, 8, 11, 8),
          cornerRadius(2),
        ]}
      >
        <Spacer modifiers={[size(10, 10), background(magnet), cornerRadius(5)]} />        <Column verticalArrangement={{ spacedBy: 2 }}>
          <Text
            color={ink}
            maxLines={2}
            overflow="ellipsis"
            style={{ fontFamily: 'serif', fontSize: 16, lineHeight: 18 }}
          >
            {props.headline}
          </Text>
          <Text
            color={props.when.length > 0 ? ink : muted}
            maxLines={1}
            overflow="ellipsis"
            style={{ fontFamily: 'monospace', fontSize: 10.5 }}
          >
            {props.when.length > 0 ? props.when : props.emptyBody}
          </Text>
        </Column>
      </Row>

      <Text
        color={muted}
        maxLines={2}
        overflow="ellipsis"
        style={{ fontFamily: 'monospace', fontSize: 8.5, lineHeight: 11 }}
      >
        {props.pending}
      </Text>
      <Text color={muted} maxLines={1} style={{ fontSize: 9 }}>{props.updated}</Text>
      <Row modifiers={[fillMaxWidth()]}>
        {props.alarmUrl !== null ? (
          <Button {...{ target: props.alarmUrl }} colors={{ containerColor: magnet, contentColor: '#ffffff' }}>
            Ver alarma
          </Button>
        ) : null}
        <Button {...{ target: props.inboxUrl }} colors={{ containerColor: paper, contentColor: ink }}>
          {props.signedIn ? 'Ver propuestas' : 'Abrir AlarmaT'}
        </Button>
      </Row>
    </Column>
  );
}

const initialProps: AlarmaTWidgetProps = {
  signedIn: false,
  headline: 'Abre AlarmaT',
  when: '',
  pending: 'Sin sesión',
  updated: 'Sin datos',
  freshness: 'ahora',
  stale: false,
  emptyBody: 'Inicia sesión para ver tus alarmas.',
  inboxUrl: 'alarmat:///',
  alarmUrl: null,
};

/** `name` debe coincidir con `widgets[0].name` de `app.config.ts`. */
export default createWidget('AlarmaTWidget', AlarmaTWidget, initialProps);
