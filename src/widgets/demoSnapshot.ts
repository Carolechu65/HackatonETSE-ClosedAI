/**
 * P6 · Estados de demostración del widget.
 *
 * **Datos simulados** para `/widget-lab`: no representan alarmas reales ni
 * escriben en la API. Sirven para ver y publicar las cuatro situaciones que el
 * widget debe distinguir. La selección la hace `buildWidgetSnapshot`, la misma
 * función de producción.
 */
import {
  buildWidgetSnapshot,
  createSignedOutWidgetSnapshot,
  type WidgetAlarmInput,
  type WidgetSnapshot,
} from './snapshot.ts';

export const WIDGET_DEMO_SCOPE = { userId: 'u-marta-demo', groupId: 'piso-4b-demo' } as const;

export type WidgetDemoState = 'next' | 'stale' | 'empty' | 'signedOut';

export const WIDGET_DEMO_STATES: readonly {
  readonly id: WidgetDemoState;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'next', label: 'Próxima alarma', hint: 'Confirmada, programada y futura + pendientes.' },
  { id: 'stale', label: 'Snapshot antiguo', hint: 'Se conserva lo último confirmado, marcado como desactualizado.' },
  { id: 'empty', label: 'Sin alarmas', hint: 'Grupo sin ocurrencias activas.' },
  { id: 'signedOut', label: 'Sesión cerrada', hint: 'Sin títulos ni contadores privados.' },
];

const HOUR = 3_600_000;

function demoAlarms(nowEpochMs: number): readonly WidgetAlarmInput[] {
  const base = {
    proposal: 'ACTIVE' as const,
    decision: 'ACCEPTED' as const,
    scheduling: 'SCHEDULED' as const,
    mode: 'ALARM' as const,
  };
  return [
    {
      ...base,
      requestId: 'demo-luz',
      title: 'Pagar la luz',
      occurrenceId: 'demo-occ-luz',
      scheduledAtEpochMs: nowEpochMs + 2.5 * HOUR,
    },
    {
      ...base,
      requestId: 'demo-basura',
      title: 'Sacar la basura',
      occurrenceId: 'demo-occ-basura',
      scheduledAtEpochMs: nowEpochMs + 15 * HOUR,
    },
    {
      ...base,
      requestId: 'demo-compra',
      title: 'Compra semanal',
      decision: 'PENDING',
      scheduling: 'NOT_SCHEDULED',
      occurrenceId: null,
      scheduledAtEpochMs: null,
    },
    {
      ...base,
      requestId: 'demo-casero',
      title: 'Llamar al casero',
      scheduling: 'PENDING_PERMISSION',
      occurrenceId: 'demo-occ-casero',
      scheduledAtEpochMs: nowEpochMs + 3 * 24 * HOUR,
    },
    {
      ...base,
      requestId: 'demo-cena',
      title: 'Cena del sábado',
      scheduling: 'CANCEL_PENDING',
      occurrenceId: 'demo-occ-cena',
      scheduledAtEpochMs: nowEpochMs + 2 * 24 * HOUR,
    },
  ];
}

/** Snapshot reproducible para el estado pedido; `nowEpochMs` se inyecta. */
export function createDemoWidgetSnapshot(state: WidgetDemoState, nowEpochMs: number): WidgetSnapshot {
  switch (state) {
    case 'next':
      return buildWidgetSnapshot({ alarms: demoAlarms(nowEpochMs), nowEpochMs, scope: WIDGET_DEMO_SCOPE });
    case 'stale':
      return buildWidgetSnapshot({
        alarms: demoAlarms(nowEpochMs),
        nowEpochMs,
        scope: WIDGET_DEMO_SCOPE,
        // Publicado hace tres horas: la próxima alarma sigue siendo futura.
        generatedAtEpochMs: nowEpochMs - 3 * HOUR,
      });
    case 'empty':
      return buildWidgetSnapshot({ alarms: [], nowEpochMs, scope: WIDGET_DEMO_SCOPE });
    case 'signedOut':
      return createSignedOutWidgetSnapshot(nowEpochMs);
    default:
      return createSignedOutWidgetSnapshot(nowEpochMs);
  }
}

/** Sesión que corresponde a cada estado de demo (para publicar/limpiar). */
export function demoSessionFor(state: WidgetDemoState): { userId: string; groupId: string } | null {
  return state === 'signedOut' ? null : WIDGET_DEMO_SCOPE;
}
