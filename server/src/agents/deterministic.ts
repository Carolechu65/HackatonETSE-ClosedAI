import { DomainError } from '../../../src/domain/errors.ts';
import { isPast } from '../../../src/domain/time.ts';
import type { AgentContext, AgentProvider, AgentDraft } from './types.ts';

/**
 * Adapter determinista para demo local y pruebas.
 *
 * NO es un modelo de IA: se identifica como `deterministic-demo` y solo
 * reconoce peticiones explícitas. Sirve para probar las invariantes del
 * orquestador (destinatario único, hora futura, revisión humana).
 */
export class DeterministicAgentProvider implements AgentProvider {
  readonly label = 'deterministic-demo';

  async next(context: AgentContext): Promise<unknown> {
    const text = context.conversation.join('\n');
    const lower = text.toLowerCase();
    const matches = context.members.filter((member) => {
      const name = member.displayName.toLowerCase();
      return new RegExp(`(^|[^a-záéíóúñ])${escapeRegExp(name)}([^a-záéíóúñ]|$)`, 'i').test(lower);
    });

    if (matches.length === 0) {
      return {
        type: 'clarification',
        question: '¿A quién del piso quieres proponerle el aviso?',
        missingFields: ['recipient'],
      };
    }
    if (matches.length > 1) {
      return {
        type: 'clarification',
        question: `He encontrado varias personas: ${matches.map((member) => member.displayName).join(', ')}. ¿A cuál te refieres?`,
        missingFields: ['recipient'],
      };
    }
    const recipient = matches[0]!;

    const timeMatch = /(?:a las|sobre las|las)\s+(\d{1,2}):(\d{2})/i.exec(text);
    if (!timeMatch) {
      return {
        type: 'clarification',
        question: `¿A qué hora quieres proponer el aviso para ${recipient.displayName}?`,
        missingFields: ['time'],
      };
    }
    const localTime = `${timeMatch[1]!.padStart(2, '0')}:${timeMatch[2]!}`;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
      return {
        type: 'clarification',
        question: 'La hora indicada no es válida. ¿Puedes repetirla en formato HH:MM?',
        missingFields: ['time'],
      };
    }

    const localDate = resolveDate(lower, context.timeZone, context.nowEpochMs);
    if (!localDate) {
      return {
        type: 'clarification',
        question: '¿Para qué día quieres proponer el aviso? Indica una fecha (YYYY-MM-DD) o di hoy/mañana.',
        missingFields: ['date'],
      };
    }

    let effectiveAtEpochMs: number;
    try {
      effectiveAtEpochMs = wallClockToEpochMs(localDate, localTime, context.timeZone);
    } catch {
      return {
        type: 'clarification',
        question: 'No he podido resolver esa fecha y hora en la zona del piso. ¿Puedes concretarla?',
        missingFields: ['date', 'time'],
      };
    }
    if (isPast(effectiveAtEpochMs, context.nowEpochMs)) {
      return {
        type: 'clarification',
        question: 'Esa hora ya pasó. ¿Para qué día y hora futuros quieres proponer el aviso?',
        missingFields: ['date', 'time'],
      };
    }

    const title = extractTitle(text, localTime, recipient.displayName).slice(0, 120);
    if (!title) {
      return {
        type: 'clarification',
        question: '¿Qué recordatorio quieres proponer? Por ejemplo: sacar la basura.',
        missingFields: ['title'],
      };
    }
    const mode = /notificaci[oó]n|recordatorio/i.test(text) ? 'NOTIFICATION' : 'ALARM';
    const draft: AgentDraft = {
      type: 'draft',
      title,
      recipientUids: [recipient.uid],
      timeSpec: {
        timeZone: context.timeZone,
        localDate,
        localTime,
        effectiveAtEpochMs,
      },
      mode,
      reason: 'Borrador generado por el adapter determinista de demo; requiere revisión y consentimiento.',
    };
    return draft;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveDate(lower: string, timeZone: string, nowEpochMs: number): string | null {
  const explicit = /(\d{4}-\d{2}-\d{2})/.exec(lower);
  if (explicit) {
    const parsed = new Date(`${explicit[1]}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return explicit[1]!;
  }
  if (/\bpasado\s+mañana\b/.test(lower)) return localDateInZone(nowEpochMs + 2 * 86_400_000, timeZone);
  if (/\bmañana\b/.test(lower)) return localDateInZone(nowEpochMs + 86_400_000, timeZone);
  if (/\bhoy\b/.test(lower)) return localDateInZone(nowEpochMs, timeZone);
  return null;
}

function localDateInZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new DomainError('INVALID_ARGUMENT', 'No se pudo resolver la fecha local.');
  return `${year}-${month}-${day}`;
}

function wallClockToEpochMs(localDate: string, localTime: string, timeZone: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined) {
    throw new DomainError('INVALID_ARGUMENT', 'Fecha u hora inválida.');
  }
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const actual = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const delta = desired - actual;
    if (delta === 0) return guess;
    guess += delta;
  }
  return guess;
}

function extractTitle(text: string, localTime: string, memberName: string): string {
  let title = text
    .replace(/^.*?recu[eé]rdale\s+(a|al)\s+/i, '')
    .replace(new RegExp(`^${escapeRegExp(memberName)}\\s*[:,-]?\\s*`, 'i'), '');
  title = title
    .replace(/\b(pasado\s+mañana|mañana|hoy)\b/gi, ' ')
    .replace(new RegExp(`\\b(?:a\\s+las|sobre\\s+las|las)\\s+${escapeRegExp(localTime)}\\b`, 'gi'), ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
  return title;
}
