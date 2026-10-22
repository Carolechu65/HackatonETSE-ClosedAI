import { addDays, createTimeSpec, formatLocalDate, isPast, MINUTE_MS, parseLocalDate, wallClockInZone } from '../../../src/domain/time.ts';
import type { TimeSpec } from '../../../src/domain/contracts/types.ts';
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
    const selfRequested = /\b(?:ponme|ponerme|recu[eé]rdame|recordarme|av[ií]same|avisarme)\b|para m[ií](?=\s|[.,!?]|$)/i.test(text);
    const matches = context.members.filter((member) => {
      if (selfRequested && member.uid === context.actorUid) return true;
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

    const relative = /\bdentro de\s+(\d+)\s*(minutos?|min|horas?|h)\b/i.exec(text);
    let timeSpec: TimeSpec;
    if (relative) {
      const minutes = Number(relative[1]) * (/^h/i.test(relative[2]!) ? 60 : 1);
      if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600) {
        return { type: 'clarification', question: '¿Dentro de cuántos minutos quieres el aviso? Indica un plazo entre un minuto y un año.', missingFields: ['time'] };
      }
      const target = Math.ceil((context.nowEpochMs + minutes * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
      timeSpec = createTimeSpec({ ...wallClockInZone(target, context.timeZone), timeZone: context.timeZone });
      // The contract chooses the first occurrence of a repeated DST wall time.
      // Ask rather than silently move a relative alarm to the wrong occurrence.
      if (timeSpec.effectiveAtEpochMs !== target) {
        return { type: 'clarification', question: 'Ese plazo cae en una hora repetida por el cambio horario. Elige otra hora para el aviso.', missingFields: ['time'] };
      }
    } else {
      const timeMatch = /(?:a las|sobre las|las)\s*(\d{1,2})(?::(\d{2})|\s*h\b)/i.exec(text);
      if (!timeMatch) {
        return { type: 'clarification', question: `¿A qué hora quieres proponer el aviso para ${recipient.displayName}?`, missingFields: ['time'] };
      }
      const localTime = `${timeMatch[1]!.padStart(2, '0')}:${timeMatch[2] ?? '00'}`;
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
        return { type: 'clarification', question: 'La hora indicada no es válida. ¿Puedes repetirla en formato HH:MM?', missingFields: ['time'] };
      }
      const localDate = resolveDate(lower, context.timeZone, context.nowEpochMs);
      if (!localDate) {
        return { type: 'clarification', question: '¿Para qué día quieres proponer el aviso? Indica una fecha (YYYY-MM-DD) o di hoy/mañana.', missingFields: ['date'] };
      }
      try {
        timeSpec = createTimeSpec({ localDate, localTime, timeZone: context.timeZone });
      } catch {
        return { type: 'clarification', question: 'No he podido resolver esa fecha y hora en la zona del piso. ¿Puedes concretarla?', missingFields: ['date', 'time'] };
      }
    }
    if (isPast(timeSpec.effectiveAtEpochMs, context.nowEpochMs)) {
      return { type: 'clarification', question: 'Esa hora ya pasó. ¿Para qué día y hora futuros quieres proponer el aviso?', missingFields: ['date', 'time'] };
    }

    const title = extractTitle(text, recipient.displayName).slice(0, 120);
    if (!title) {
      return {
        type: 'clarification',
        question: '¿Qué recordatorio quieres proponer? Por ejemplo: sacar la basura.',
        missingFields: ['title'],
      };
    }
    const mode = /notificaci[oó]n|recordatorio/i.test(text) ? 'NOTIFICATION' : 'ALARM';
    const matchingTasks = context.tasks.filter(task => task.status === 'PENDING' && lower.includes(task.title.toLowerCase()));
    const draft: AgentDraft = {
      type: 'draft',
      title,
      recipientUids: [recipient.uid],
      timeSpec,
      mode,
      ...(matchingTasks.length === 1 ? { taskId: matchingTasks[0]!.id } : {}),
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
  if (explicit) return parseLocalDate(explicit[1]) ? explicit[1]! : null;
  const today = parseLocalDate(wallClockInZone(nowEpochMs, timeZone).localDate)!;
  if (/\bpasado\s+mañana\b/.test(lower)) return formatLocalDate(addDays(today, 2));
  if (/\bmañana\b/.test(lower)) return formatLocalDate(addDays(today, 1));
  if (/\bhoy\b/.test(lower)) return formatLocalDate(today);
  return null;
}

function extractTitle(text: string, memberName: string): string {
  return text
    .replace(/^.*?recu[eé]rdale\s+(a|al)\s+/i, '')
    .replace(/^(?:ponme|ponerme|recu[eé]rdame|recordarme|av[ií]same|avisarme)\s+/i, '')
    .replace(new RegExp(`^${escapeRegExp(memberName)}\\s*[:,-]?\\s*`, 'i'), '')
    .replace(/\b(?:pasado\s+mañana|mañana|hoy)\b/gi, ' ')
    .replace(/\b(?:a\s+las|sobre\s+las|las)\s*\d{1,2}(?::\d{2}|\s*h\b)/gi, ' ')
    .replace(/\bdentro de\s+\d+\s*(?:minutos?|min|horas?|h)\b/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bpara\s*$/i, '')
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
}
