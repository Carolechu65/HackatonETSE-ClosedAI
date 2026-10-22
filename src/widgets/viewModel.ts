/**
 * P6 · Traducción de `WidgetSnapshot` a props serializables del widget.
 *
 * El runtime del widget es aislado: no tiene hooks, ni acceso a SQLite, ni `Intl`
 * garantizado. Por eso la app precalcula aquí todos los textos y enlaces, y la
 * plantilla (`AlarmaTWidget.tsx`) solo pinta cadenas y colores.
 *
 * Este archivo es puro: se prueba en Node con zona horaria y reloj inyectados.
 */
import { alarmLink, inboxLink, isSafeLinkId } from './links.ts';
import {
  isWidgetSnapshotStale,
  isValidWidgetSnapshot,
  createSignedOutWidgetSnapshot,
  WIDGET_SNAPSHOT_MAX_AGE_MS,
  type WidgetSnapshot,
} from './snapshot.ts';

/** Props que cruzan a la plantilla del widget. Solo valores JSON. */
export type AlarmaTWidgetProps = {
  readonly signedIn: boolean;
  readonly headline: string;
  readonly when: string;
  readonly pending: string;
  /** Texto completo para la app o un detalle accesible. */
  readonly updated: string;
  /** Versión corta para la cabecera del widget: «ahora», «hace 5 min». */
  readonly freshness: string;
  readonly stale: boolean;
  readonly emptyBody: string;
  readonly inboxUrl: string;
  readonly alarmUrl: string | null;
};

export type WidgetViewModelOptions = {
  /** Zona del grupo o del dispositivo; explícita para que los tests sean deterministas. */
  readonly timeZone?: string;
  readonly maxAgeMs?: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateParts(epochMs: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day') };
}

function localTime(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

function weekdayShort(epochMs: number, timeZone: string): string {
  const label = new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'short' })
    .format(new Date(epochMs))
    .replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** «Hoy · 19:30», «Mañana · 08:00», «Vie 23 · 21:00». */
export function formatAlarmWhen(epochMs: number, nowEpochMs: number, timeZone: string): string {
  const target = localDateParts(epochMs, timeZone);
  const today = localDateParts(nowEpochMs, timeZone);
  const targetDay = Date.UTC(target.year, target.month - 1, target.day);
  const todayDay = Date.UTC(today.year, today.month - 1, today.day);
  const dayDelta = Math.round((targetDay - todayDay) / 86_400_000);
  const time = localTime(epochMs, timeZone);

  if (dayDelta === 0) return `Hoy · ${time}`;
  if (dayDelta === 1) return `Mañana · ${time}`;
  return `${weekdayShort(epochMs, timeZone)} ${pad2(target.day)} · ${time}`;
}

/** «ahora mismo», «hace 5 min», «hace 2 h», «hace 3 d». */
export function describeFreshness(generatedAtEpochMs: number, nowEpochMs: number): string {
  const elapsed = nowEpochMs - generatedAtEpochMs;
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'ahora mismo';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Resume los contadores en una sola línea corta, sin inventar urgencias. */
export function formatPendingLine(snapshot: WidgetSnapshot): string {
  const parts: string[] = [];
  if (snapshot.counts.pendingProposals > 0) {
    parts.push(plural(snapshot.counts.pendingProposals, 'propuesta', 'propuestas'));
  }
  if (snapshot.counts.pendingActivations > 0) {
    parts.push(`${snapshot.counts.pendingActivations} por activar`);
  }
  if (snapshot.counts.withdrawalPending > 0) {
    parts.push(`${snapshot.counts.withdrawalPending} sin acuse`);
  }
  return parts.length === 0 ? 'Sin pendientes' : parts.join(' · ');
}

function safeAlarmUrl(requestId: string): string | null {
  if (!isSafeLinkId(requestId)) return null;
  try {
    return alarmLink(requestId);
  } catch {
    return null;
  }
}

/**
 * Construye las props del widget. Un snapshot caducado sigue mostrando la última
 * información confirmada, pero se marca `stale` y la plantilla lo dice.
 */
export function toWidgetProps(
  snapshot: WidgetSnapshot,
  nowEpochMs: number,
  options: WidgetViewModelOptions = {},
): AlarmaTWidgetProps {
  if (!isValidWidgetSnapshot(snapshot)) snapshot = createSignedOutWidgetSnapshot(nowEpochMs);
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const maxAgeMs = options.maxAgeMs ?? WIDGET_SNAPSHOT_MAX_AGE_MS;
  const stale = isWidgetSnapshotStale(snapshot, nowEpochMs, maxAgeMs);
  const freshness = describeFreshness(snapshot.generatedAtEpochMs, nowEpochMs);
  // Relative text freezes when the app is closed. An absolute date remains truthful.
  const updated = `Lectura: ${new Intl.DateTimeFormat('es-ES', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(snapshot.generatedAtEpochMs))}`;

  if (snapshot.scope === null) {
    return {
      signedIn: false,
      headline: 'Abre AlarmaT',
      when: '',
      pending: 'Sin sesión',
      updated,
      freshness,
      stale: false,
      emptyBody: 'Inicia sesión para ver tus alarmas.',
      inboxUrl: inboxLink(),
      alarmUrl: null,
    };
  }

  const next = snapshot.nextAlarm !== null && snapshot.nextAlarm.scheduledAtEpochMs > nowEpochMs
    ? snapshot.nextAlarm : null;
  const pending = formatPendingLine(snapshot);

  if (next === null) {
    const hasPending = snapshot.counts.pendingProposals > 0;
    return {
      signedIn: true,
      headline: hasPending ? 'Tienes propuestas' : 'Nada a la vista',
      when: '',
      pending,
      updated,
      freshness,
      stale,
      emptyBody: hasPending
        ? `${plural(snapshot.counts.pendingProposals, 'propuesta espera', 'propuestas esperan')} tu decisión.`
        : 'Cuando haya una alarma aceptada y programada, aparecerá aquí.',
      inboxUrl: inboxLink(),
      alarmUrl: null,
    };
  }

  return {
    signedIn: true,
    headline: next.title,
    when: formatAlarmWhen(next.scheduledAtEpochMs, nowEpochMs, timeZone),
    pending,
    updated,
    freshness,
    stale,
    emptyBody: '',
    inboxUrl: inboxLink(),
    alarmUrl: safeAlarmUrl(next.requestId),
  };
}
