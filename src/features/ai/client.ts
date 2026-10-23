import type { AiConnectionInput, AiProviderId, AiStatus } from './types.ts';
type Transport = (path: string, method?: 'GET' | 'POST', body?: unknown) => Promise<unknown>;
const invalid = () => new Error('No se pudo leer la conexión de IA.');
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(); return v as Record<string, unknown>; }
function text(v: unknown): string { if (typeof v !== 'string') throw invalid(); return v; }
function provider(v: unknown): AiProviderId { if (!['openai', 'openrouter', 'opencode', 'deepseek'].includes(String(v))) throw invalid(); return v as AiProviderId; }
function status(raw: unknown): AiStatus {
  const v = record(raw); if (typeof v.available !== 'boolean' || !Array.isArray(v.providers)) throw invalid();
  const c = v.connection === null ? null : record(v.connection);
  if (c && (typeof c.verifiedAt !== 'number' || !Number.isFinite(c.verifiedAt) || !/^••••.{4}$/.test(text(c.maskedKey)))) throw invalid();
  return { available: v.available, connection: c ? { provider: provider(c.provider), model: text(c.model), maskedKey: text(c.maskedKey), verifiedAt: c.verifiedAt as number } : null,
    providers: v.providers.map(item => { const p = record(item); if (!Array.isArray(p.models)) throw invalid(); return { id: provider(p.id), name: text(p.name), models: p.models.map(text) }; }) };
}
export function createAiClient(request: Transport) {
  return {
    async status() { return status(await request('/v1/ai/connection')); },
    async test(input: AiConnectionInput) { const v = record(await request('/v1/ai/connection/test', 'POST', input)); const token = text(v.testToken); if (!/^[a-f0-9]{64}$/.test(token)) throw invalid(); return { testToken: token, message: text(v.message) }; },
    async save(input: AiConnectionInput, testToken: string) { return status(await request('/v1/ai/connection/save', 'POST', { ...input, testToken })); },
    async remove() { return status(await request('/v1/ai/connection/delete', 'POST', {})); },
  };
}
export type AiClient = ReturnType<typeof createAiClient>;
