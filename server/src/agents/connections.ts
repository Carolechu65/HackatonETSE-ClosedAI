import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '../../../src/domain/errors.ts';
import type { AiConnectionInput, AiProviderId, AiStatus } from '../../../src/features/ai/types.ts';
import { authenticate, type AuthUser } from '../auth/service.ts';
import type { Db } from '../persistence/db.ts';
import { asRecord } from '../lib/validation.ts';
import { FixedWindowLimiter } from '../lib/rateLimit.ts';
import { AI_PROVIDERS, PersonalAiProvider, PROVIDER_UNAVAILABLE } from './personalProvider.ts';
import { AgentProviderError, type AgentProvider } from './types.ts';

type Row = { owner_uid: string; revision: string; provider: AiProviderId; model: string; secret_ciphertext: string; key_last4: string; verified_at_epoch_ms: number };
type Ticket = { owner_uid: string; session_id: string; fingerprint: string; previous_revision: string | null; verified: number; expires_at_epoch_ms: number };
const unavailable = () => new DomainError('TEMPORARY_UNAVAILABLE', PROVIDER_UNAVAILABLE);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function loadAiCredentialKey(file: string | undefined): Buffer | null {
  if (!file) return null;
  if (!isAbsolute(file)) throw new Error('AI_CREDENTIAL_KEY_FILE debe ser una ruta absoluta privada.');
  const stat = statSync(file);
  if (!stat.isFile() || (stat.mode & 0o007) !== 0 || (stat.mode & 0o020) !== 0) throw new Error('El fichero de cifrado de IA tiene permisos inseguros.');
  const hex = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('La clave de cifrado de IA debe tener 32 bytes hexadecimales.');
  return Buffer.from(hex, 'hex');
}
function parseInput(raw: unknown, save = false): AiConnectionInput {
  const v = asRecord(raw);
  if (Object.keys(v).some(k => !['provider', 'model', 'apiKey', ...(save ? ['testToken'] : [])].includes(k))) throw new DomainError('INVALID_ARGUMENT', 'Campos de conexión inválidos.');
  if (!AI_PROVIDERS.some(p => p.id === v.provider) || typeof v.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,159}$/.test(v.model)) throw new DomainError('INVALID_ARGUMENT', 'Elige un proveedor y un identificador de modelo válido.');
  if (typeof v.apiKey !== 'string' || v.apiKey.length < 8 || v.apiKey.length > 2048 || !/^[\x21-\x7e]+$/.test(v.apiKey)) throw new DomainError('INVALID_ARGUMENT', 'La clave no tiene un formato válido. Pégala sin espacios.');
  return { provider: v.provider as AiProviderId, model: v.model, apiKey: v.apiKey };
}
export class AiConnections {
  private readonly inFlight = new Set<string>();
  constructor(private readonly db: Db, private readonly key: Buffer | null, private readonly timeoutMs = 30_000, private readonly transport: typeof fetch = fetch) {}
  private requireKey(): Buffer { if (!this.key || this.key.length !== 32) throw unavailable(); return this.key; }
  private row(uid: string) { return this.db.prepare('SELECT * FROM ai_connections WHERE owner_uid=?').get(uid) as Row | undefined; }
  status(uid: string): AiStatus {
    const row = this.row(uid);
    return { available: !!this.key, providers: AI_PROVIDERS, connection: row ? { provider: row.provider, model: row.model, maskedKey: `••••${row.key_last4}`, verifiedAt: row.verified_at_epoch_ms } : null };
  }
  private aad(uid: string, provider: string, model: string) { return Buffer.from(JSON.stringify(['alarmat-ai-v1', uid, provider, model])); }
  private encrypt(uid: string, input: AiConnectionInput) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv); cipher.setAAD(this.aad(uid, input.provider, input.model));
    const encrypted = Buffer.concat([cipher.update(input.apiKey, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  }
  private decrypt(row: Row): string {
    try {
      const [version, iv, tag, data] = row.secret_ciphertext.split('.'); if (version !== 'v1' || !iv || !tag || !data) throw new Error('invalid');
      const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), Buffer.from(iv, 'base64')); decipher.setAAD(this.aad(row.owner_uid, row.provider, row.model)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw unavailable(); }
  }
  private fingerprint(input: AiConnectionInput) { return createHmac('sha256', this.requireKey()).update(JSON.stringify(input)).digest('hex'); }
  async test(actor: AuthUser, raw: unknown, reauthenticate: () => void) {
    this.requireKey(); const input = parseInput(raw);
    if (this.inFlight.has(actor.uid)) throw new DomainError('RATE_LIMITED', 'Ya hay una prueba en curso.');
    this.inFlight.add(actor.uid);
    const token = randomBytes(32).toString('hex'); const id = hash(token);
    try {
    this.db.prepare('DELETE FROM ai_connection_tests WHERE expires_at_epoch_ms<=? OR owner_uid=?').run(Date.now(), actor.uid);
    this.db.prepare('INSERT INTO ai_connection_tests(token_hash,owner_uid,session_id,fingerprint,previous_revision,expires_at_epoch_ms) VALUES (?,?,?,?,?,?)')
      .run(id, actor.uid, actor.sessionId, this.fingerprint(input), this.row(actor.uid)?.revision ?? null, Date.now() + 600_000);
      await new PersonalAiProvider(input, this.timeoutMs, this.transport).test();
      reauthenticate();
      const changed = this.db.prepare('UPDATE ai_connection_tests SET verified=1 WHERE token_hash=? AND expires_at_epoch_ms>?').run(id, Date.now()).changes;
      if (!changed) throw new DomainError('VERSION_CONFLICT', 'La conexión cambió durante la prueba. Vuelve a probarla.');
      return { testToken: token, expiresInSeconds: 600, message: 'Conexión verificada. Guarda para usarla con tu asistente.' };
    } catch (error) {
      this.db.prepare('DELETE FROM ai_connection_tests WHERE token_hash=?').run(id);
      if (error instanceof DomainError) throw error;
      throw unavailable();
    } finally { this.inFlight.delete(actor.uid); }
  }
  save(actor: AuthUser, raw: unknown): AiStatus {
    const input = parseInput(raw, true); const token = asRecord(raw).testToken;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new DomainError('INVALID_ARGUMENT', 'Prueba la conexión antes de guardarla.');
    this.db.transaction(() => {
      const ticket = this.db.prepare('SELECT * FROM ai_connection_tests WHERE token_hash=?').get(hash(token)) as Ticket | undefined;
      if (!ticket || ticket.owner_uid !== actor.uid || ticket.session_id !== actor.sessionId || !ticket.verified || ticket.expires_at_epoch_ms <= Date.now()
        || !timingSafeEqual(Buffer.from(ticket.fingerprint, 'hex'), Buffer.from(this.fingerprint(input), 'hex'))) throw new DomainError('INVALID_ARGUMENT', 'La prueba no corresponde a esta conexión o ha caducado. Vuelve a probarla.');
      if (ticket.previous_revision !== (this.row(actor.uid)?.revision ?? null)) throw new DomainError('VERSION_CONFLICT', 'La conexión ha cambiado. Vuelve a probarla.');
      this.db.prepare(`INSERT INTO ai_connections(owner_uid,revision,provider,model,secret_ciphertext,key_last4,verified_at_epoch_ms) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(owner_uid) DO UPDATE SET revision=excluded.revision,provider=excluded.provider,model=excluded.model,secret_ciphertext=excluded.secret_ciphertext,key_last4=excluded.key_last4,verified_at_epoch_ms=excluded.verified_at_epoch_ms`)
        .run(actor.uid, randomUUID(), input.provider, input.model, this.encrypt(actor.uid, input), input.apiKey.slice(-4), Date.now());
      this.db.prepare('DELETE FROM ai_connection_tests WHERE owner_uid=?').run(actor.uid);
    })();
    return this.status(actor.uid);
  }
  remove(uid: string) {
    this.db.transaction(() => { this.db.prepare('DELETE FROM ai_connections WHERE owner_uid=?').run(uid); this.db.prepare('DELETE FROM ai_connection_tests WHERE owner_uid=?').run(uid); })();
    return this.status(uid);
  }
  provider(uid: string): AgentProvider {
    const row = this.row(uid);
    if (!row) throw new DomainError('TEMPORARY_UNAVAILABLE', 'Conecta tu IA en Ajustes para usar el asistente, o crea la alarma manualmente.');
    const delegate = new PersonalAiProvider({ provider: row.provider, model: row.model, apiKey: this.decrypt(row) }, this.timeoutMs, this.transport);
    const current = () => { if (this.row(uid)?.revision !== row.revision) throw new AgentProviderError(PROVIDER_UNAVAILABLE); };
    return { label: delegate.label, next: async (context, feedback) => { current(); const result = await delegate.next(context, feedback); current(); return result; } };
  }
}
export function aiConnectionRoutes(app: FastifyInstance, db: Db, connections: AiConnections) {
  const limiter = new FixedWindowLimiter(5, 60_000); const total = new FixedWindowLimiter(50, 60_000);
  const actor = (req: FastifyRequest) => authenticate(db, req.headers.authorization);
  app.get('/v1/ai/connection', async req => connections.status(actor(req).uid));
  app.post('/v1/ai/connection/test', async req => { const user = actor(req); limiter.check(user.uid); total.check('tests'); return connections.test(user, req.body, () => { actor(req); }); });
  app.post('/v1/ai/connection/save', async req => connections.save(actor(req), req.body));
  app.post('/v1/ai/connection/delete', async req => { const user = actor(req); if (req.body && Object.keys(asRecord(req.body)).length) throw new DomainError('INVALID_ARGUMENT', 'No se admiten campos.'); return connections.remove(user.uid); });
}
