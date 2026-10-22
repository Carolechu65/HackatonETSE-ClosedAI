import type { Db } from '../persistence/db.ts';
import type { PushMessage, PushSender } from './push.ts';

export type OutboxWorkerOptions = {
  pollIntervalMs: number;
  leaseMs: number;
  logger?: { info: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
};

export type OutboxRunResult = {
  processed: boolean;
  delivered: boolean;
  eventId?: string;
  recipients: number;
  error?: string;
};

type OutboxRow = {
  id: string;
  audience_uid: string;
  group_id: string | null;
  kind: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  payload_json: string;
  attempts: number;
  next_attempt_at_epoch_ms: number;
  lease_until_epoch_ms: number | null;
  delivered_at_epoch_ms: number | null;
  last_error: string | null;
  created_at_epoch_ms: number;
};

/**
 * Worker de la outbox del servidor. Las llamadas de red ocurren después del
 * commit y fuera de la transacción de dominio. La entrega puede repetirse.
 */
export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly sender: PushSender | null,
    private readonly options: OutboxWorkerOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.drain();
    }, this.options.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(maxRounds = 10): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        const result = await this.runOnce();
        if (!result.processed) break;
      }
    } finally {
      this.running = false;
    }
  }

  async runOnce(nowEpochMs = Date.now()): Promise<OutboxRunResult> {
    const event = this.claimNext(nowEpochMs);
    if (!event) return { processed: false, delivered: false, recipients: 0 };
    if (!this.sender) {
      this.fail(event, nowEpochMs, 'push_not_configured');
      return { processed: true, delivered: false, eventId: event.id, recipients: 0, error: 'push_not_configured' };
    }

    const tokens = this.tokensFor(event.audience_uid);
    if (tokens.length === 0) {
      this.db
        .prepare(
          'UPDATE outbox_events SET delivered_at_epoch_ms = ?, lease_until_epoch_ms = NULL, last_error = ? WHERE id = ?',
        )
        .run(nowEpochMs, 'no_push_token', event.id);
      return { processed: true, delivered: false, eventId: event.id, recipients: 0, error: 'no_push_token' };
    }

    const payload = safeJson(event.payload_json);
    const messages: PushMessage[] = tokens.map((token) => ({
      to: token.push_token,
      title: 'alarmaT',
      body: 'Tienes una actualización en tu piso.',
      data: {
        eventId: event.id,
        kind: event.kind,
        groupId: event.group_id,
        entityType: event.entity_type,
        entityId: event.entity_id,
        entityVersion: event.entity_version,
        ...(payload ? { hint: payload } : {}),
      },
    }));

    const result = await this.sender.send(messages);
    if (result.ok) {
      this.db
        .prepare(
          'UPDATE outbox_events SET delivered_at_epoch_ms = ?, lease_until_epoch_ms = NULL, attempts = attempts + 1, last_error = NULL WHERE id = ?',
        )
        .run(nowEpochMs, event.id);
      this.deactivateInvalidTokens(result.invalidTokens ?? []);
      this.options.logger?.info(
        { eventId: event.id, recipients: tokens.length, attempts: event.attempts + 1 },
        'outbox delivered',
      );
      return { processed: true, delivered: true, eventId: event.id, recipients: tokens.length };
    }

    this.deactivateInvalidTokens(result.invalidTokens ?? []);
    this.fail(event, nowEpochMs, result.error ?? 'push_failed');
    return {
      processed: true,
      delivered: false,
      eventId: event.id,
      recipients: tokens.length,
      error: result.error ?? 'push_failed',
    };
  }

  private claimNext(nowEpochMs: number): OutboxRow | null {
    const claim = this.db.transaction((): OutboxRow | null => {
      const row = this.db
        .prepare(
          `SELECT * FROM outbox_events
           WHERE delivered_at_epoch_ms IS NULL
             AND next_attempt_at_epoch_ms <= ?
             AND (lease_until_epoch_ms IS NULL OR lease_until_epoch_ms < ?)
           ORDER BY next_attempt_at_epoch_ms, id
           LIMIT 1`,
        )
        .get(nowEpochMs, nowEpochMs) as OutboxRow | undefined;
      if (!row) return null;
      this.db
        .prepare('UPDATE outbox_events SET lease_until_epoch_ms = ? WHERE id = ?')
        .run(nowEpochMs + this.options.leaseMs, row.id);
      return row;
    });
    return claim.immediate();
  }

  private fail(event: OutboxRow, nowEpochMs: number, error: string): void {
    const attempts = event.attempts + 1;
    const backoffMs = Math.min(60_000 * 2 ** Math.min(attempts, 6), 60 * 60 * 1000);
    const jitterMs = Math.floor(Math.random() * 1_000);
    this.db
      .prepare(
        `UPDATE outbox_events SET attempts = ?, next_attempt_at_epoch_ms = ?, lease_until_epoch_ms = NULL, last_error = ?
         WHERE id = ?`,
      )
      .run(attempts, nowEpochMs + backoffMs + jitterMs, error, event.id);
    this.options.logger?.error({ eventId: event.id, attempts, error }, 'outbox delivery failed');
  }

  private tokensFor(uid: string): Array<{ device_id: string; push_token: string }> {
    return this.db
      .prepare(
        "SELECT id AS device_id, push_token FROM devices WHERE user_id = ? AND status = 'ACTIVE' AND push_token IS NOT NULL",
      )
      .all(uid) as Array<{ device_id: string; push_token: string }>;
  }

  private deactivateInvalidTokens(tokens: string[]): void {
    if (tokens.length === 0) return;
    const statement = this.db.prepare('UPDATE devices SET push_token = NULL, updated_at_epoch_ms = ? WHERE push_token = ?');
    for (const token of tokens) statement.run(Date.now(), token);
  }
}

function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
