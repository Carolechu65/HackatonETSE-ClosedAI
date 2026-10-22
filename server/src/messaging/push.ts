import { DomainError } from '../../../src/domain/errors.ts';

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type PushResult = {
  ok: boolean;
  invalidTokens?: string[];
  error?: string;
};

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult>;
}

/**
 * Transporte Expo Push. Sin token configurado no se llama a la red:
 * la outbox permanece pendiente y la app usa sincronización al abrir.
 */
export class ExpoPushSender implements PushSender {
  constructor(private readonly accessToken: string | null, private readonly endpoint = 'https://exp.host/--/api/v2/push/send') {}

  async send(messages: PushMessage[]): Promise<PushResult> {
    if (!this.accessToken) return { ok: false, error: 'push_not_configured' };
    if (messages.length === 0) return { ok: true };
    const payload = messages.map((message) => ({
      to: message.to,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: null as null,
      priority: 'default',
    }));
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return { ok: false, error: `expo_push_http_${response.status}` };
      const body = (await response.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
      if (!Array.isArray(body.data)) return { ok: false, error: 'expo_push_invalid_response' };
      const invalidTokens: string[] = [];
      for (let index = 0; index < body.data.length; index += 1) {
        const ticket = body.data[index];
        if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const token = messages[index]?.to;
          if (token) invalidTokens.push(token);
        }
      }
      const failed = body.data.some((ticket) => ticket?.status === 'error');
      return { ok: !failed, invalidTokens, error: failed ? 'expo_push_ticket_error' : undefined };
    } catch {
      return { ok: false, error: 'expo_push_network_error' };
    }
  }
}

/** Adaptador de pruebas: nunca se presenta como entrega real. */
export class RecordingPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  constructor(private readonly result: PushResult = { ok: true }) {}
  async send(messages: PushMessage[]): Promise<PushResult> {
    this.sent.push(...messages);
    return this.result;
  }
}

/** Validación mínima de entrada del agente/push; evita tokens absurdos. */
export function assertExpoPushToken(token: string): void {
  if (!/^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token) && !/^ExpoPushToken\[[A-Za-z0-9_-]+\]$/.test(token)) {
    throw new DomainError('INVALID_ARGUMENT', 'Token de push no válido.');
  }
}
