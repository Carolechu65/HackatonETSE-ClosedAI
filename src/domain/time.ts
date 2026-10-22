/**
 * Tiempo del dominio: instante UTC en ms + zona IANA + hora civil.
 *
 * Política de cambio horario (acordada en `docs/adr/003-politica-dst.md`):
 * - Hora inexistente (salto primaveral): se desplaza hacia delante la duración del salto.
 * - Hora repetida (salto otoñal): se usa la primera ocurrencia, el instante UTC menor.
 */
import { DomainError } from './errors.ts';
import type { TimeSpec, WeeklyRecurrence } from './contracts/types.ts';

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type LocalDate = { year: number; month: number; day: number };
export type LocalTime = { hour: number; minute: number };

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length < 3 || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    formatterCache.delete(timeZone);
    return false;
  }
}

export function parseLocalDate(value: unknown): LocalDate | null {
  if (typeof value !== 'string') return null;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (asUtc.getUTCFullYear() !== year || asUtc.getUTCMonth() !== month - 1 || asUtc.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function parseLocalTime(value: unknown): LocalTime | null {
  if (typeof value !== 'string') return null;
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatLocalDate(date: LocalDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Lunes = 1 … domingo = 7, como en `weeklyRecurrence.isoWeekday`. */
export function isoWeekdayOf(date: LocalDate): number {
  const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return ((dayOfWeek + 6) % 7) + 1;
}

function partsInZone(epochMs: number, timeZone: string): LocalDate & LocalTime & { second: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : Number.NaN;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Desfase de la zona respecto a UTC en ese instante, en milisegundos. */
export function zoneOffsetMsAt(epochMs: number, timeZone: string): number {
  const wholeSecond = epochMs - (epochMs % SECOND_MS);
  const parts = partsInZone(wholeSecond, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - wholeSecond;
}

function wallClockKey(epochMs: number, timeZone: string): string {
  const parts = partsInZone(epochMs, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function wallClockInZone(epochMs: number, timeZone: string): { localDate: string; localTime: string } {
  if (!Number.isFinite(epochMs)) throw new DomainError('INVALID_ARGUMENT', 'Instante inválido.', { epochMs });
  if (!isValidTimeZone(timeZone)) throw new DomainError('INVALID_ARGUMENT', 'Zona horaria desconocida.', { timeZone });
  const parts = partsInZone(epochMs, timeZone);
  return {
    localDate: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    localTime: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
  };
}

/**
 * Resuelve una hora civil de una zona a un instante UTC.
 * Lanza `INVALID_ARGUMENT` si la fecha, la hora o la zona no son válidas.
 */
export function wallClockToEpochMs(input: { timeZone: string; localDate: string; localTime: string }): number {
  const date = parseLocalDate(input.localDate);
  const time = parseLocalTime(input.localTime);
  if (!date || !time) {
    throw new DomainError('INVALID_ARGUMENT', 'Fecha u hora civil inválidas.', {
      localDate: input.localDate,
      localTime: input.localTime,
    });
  }
  if (!isValidTimeZone(input.timeZone)) {
    throw new DomainError('INVALID_ARGUMENT', 'Zona horaria desconocida.', { timeZone: input.timeZone });
  }

  const target = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const requested = `${input.localDate}T${input.localTime}`;
  const offsets = new Set([
    zoneOffsetMsAt(target - DAY_MS, input.timeZone),
    zoneOffsetMsAt(target + DAY_MS, input.timeZone),
  ]);
  const candidates = [...offsets]
    .map((offset) => target - offset)
    .filter((candidate) => wallClockKey(candidate, input.timeZone) === requested);

  if (candidates.length > 0) {
    // Hora repetida: primera ocurrencia = instante UTC menor.
    return Math.min(...candidates);
  }

  // Hora inexistente: el desfase previo al salto desplaza la hora civil hacia delante.
  return target - zoneOffsetMsAt(target - DAY_MS, input.timeZone);
}

export function createTimeSpec(input: { timeZone: string; localDate: string; localTime: string }): TimeSpec {
  return {
    timeZone: input.timeZone,
    localDate: input.localDate,
    localTime: input.localTime,
    effectiveAtEpochMs: wallClockToEpochMs(input),
  };
}

/** El instante guardado debe ser exactamente el resuelto para esa hora civil y zona. */
export function assertTimeSpecConsistent(spec: TimeSpec): void {
  const expected = wallClockToEpochMs(spec);
  if (spec.effectiveAtEpochMs !== expected) {
    throw new DomainError('INVALID_ARGUMENT', 'El instante no coincide con la hora civil y la zona indicadas.', {
      effectiveAtEpochMs: spec.effectiveAtEpochMs,
      expectedEpochMs: expected,
    });
  }
}

export function formatInZone(
  epochMs: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' },
): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone, hour12: false, ...options }).format(new Date(epochMs));
}

/** «vie, 23 oct · 21:00» en la zona indicada. */
export function formatDateTimeInZone(epochMs: number, timeZone: string): string {
  return formatInZone(epochMs, timeZone, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isPast(epochMs: number, nowEpochMs: number): boolean {
  return epochMs <= nowEpochMs;
}

/**
 * Siguiente ocurrencia semanal estrictamente posterior a `afterEpochMs`.
 * Recalcula la hora civil en cada fecha, así que el salto de hora no altera la hora local.
 */
export function nextWeeklyOccurrence(
  recurrence: WeeklyRecurrence,
  timeZone: string,
  afterEpochMs: number,
): number | null {
  if (!isValidTimeZone(timeZone)) {
    throw new DomainError('INVALID_ARGUMENT', 'Zona horaria desconocida.', { timeZone });
  }
  if (!parseLocalTime(recurrence.localTime)) {
    throw new DomainError('INVALID_ARGUMENT', 'Hora de recurrencia inválida.', { localTime: recurrence.localTime });
  }
  const base = wallClockInZone(afterEpochMs, timeZone);
  const startDate = parseLocalDate(base.localDate);
  if (!startDate) throw new DomainError('INVALID_ARGUMENT', 'Fecha local inválida.', { localDate: base.localDate });

  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addDays(startDate, offset);
    if (isoWeekdayOf(date) !== recurrence.isoWeekday) continue;
    const candidate = wallClockToEpochMs({
      timeZone,
      localDate: formatLocalDate(date),
      localTime: recurrence.localTime,
    });
    if (candidate <= afterEpochMs) continue;
    if (recurrence.untilEpochMs !== undefined && candidate > recurrence.untilEpochMs) return null;
    return candidate;
  }
  return null;
}

/** Siguientes `count` ocurrencias, para reconciliar sin duplicar la serie. */
export function nextWeeklyOccurrences(
  recurrence: WeeklyRecurrence,
  timeZone: string,
  afterEpochMs: number,
  count: number,
): number[] {
  const occurrences: number[] = [];
  let cursor = afterEpochMs;
  for (let index = 0; index < count; index += 1) {
    const next = nextWeeklyOccurrence(recurrence, timeZone, cursor);
    if (next === null) break;
    occurrences.push(next);
    cursor = next;
  }
  return occurrences;
}
