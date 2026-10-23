import { createTimeSpec } from '../../../src/domain/time.ts';
import type { AiProviderChoice, AiConnectionInput } from '../../../src/features/ai/types.ts';
import { AgentProviderError, type AgentContext, type AgentProvider } from './types.ts';
import { SYSTEM_PROMPT, buildContextMessage } from './openai.ts';

export const AI_PROVIDERS: AiProviderChoice[] = [
  { id: 'openrouter', name: 'OpenRouter', models: ['deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna'] },
  { id: 'openai', name: 'OpenAI', models: ['gpt-6-luna'] },
  { id: 'opencode', name: 'OpenCode', models: ['deepseek-v4.1-flash', 'gpt-6-luna'] },
  { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-flash', 'deepseek-v4-pro'] },
];
export const PROVIDER_UNAVAILABLE = 'Tu proveedor no está disponible. Revisa tu conexión o crea la alarma manualmente.';
// No user-controlled URLs, redirects, tools, fallbacks or credentials in model context.
export function endpointFor(input: AiConnectionInput) {
  switch (input.provider) {
    case 'openai': return { url: 'https://api.openai.com/v1/responses', responses: true };
    case 'openrouter': return { url: 'https://openrouter.ai/api/v1/chat/completions', responses: false };
    case 'deepseek': return { url: 'https://api.deepseek.com/chat/completions', responses: false };
    case 'opencode': { const responses = /^gpt-|^o[134](?:-|$)/.test(input.model); return { url: `https://opencode.ai/inference/openai/v1/${responses ? 'responses' : 'chat/completions'}`, responses }; }
    default: throw new AgentProviderError(PROVIDER_UNAVAILABLE);
  }
}
export class PersonalAiProvider implements AgentProvider {
  readonly label: string;
  constructor(private readonly input: AiConnectionInput, private readonly timeoutMs: number, private readonly transport: typeof fetch = fetch) {
    this.label = `${input.provider}:${input.model}`;
  }
  private async complete(messages: Array<{ role: string; content: string }>, limit: number): Promise<unknown> {
    const endpoint = endpointFor(this.input);
    const body = endpoint.responses ? {
      model: this.input.model, input: messages, store: false, max_output_tokens: limit,
      text: { format: { type: 'json_object' } }, ...(/^gpt-[56]/.test(this.input.model) ? { reasoning: { effort: 'low' } } : {}),
    } : {
      model: this.input.model, messages, max_tokens: limit, response_format: { type: 'json_object' },
      ...(this.input.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
    };
    try {
      const response = await this.transport(endpoint.url, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.input.apiKey}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) { await response.body?.cancel(); throw new AgentProviderError(PROVIDER_UNAVAILABLE); }
      // Limit both response time (including streaming body) and memory consumption.
      const reader = response.body?.getReader(); if (!reader) throw new Error('empty');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 128 * 1024) throw new Error('large'); chunks.push(item.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let content: unknown;
      if (endpoint.responses) {
        if (result.status !== 'completed' || !Array.isArray(result.output)) throw new Error('incomplete');
        content = result.output.filter((o: { type?: string }) => o.type === 'message').flatMap((o: { content?: Array<{ type?: string; text?: string }> }) => o.content ?? []).filter((c: { type?: string }) => c.type === 'output_text').map((c: { text?: string }) => c.text ?? '').join('');
      } else {
        if (result.choices?.[0]?.finish_reason !== 'stop') throw new Error('incomplete');
        content = result.choices?.[0]?.message?.content;
      }
      if (typeof content !== 'string' || !content.trim()) throw new Error('empty');
      return JSON.parse(content);
    } catch { throw new AgentProviderError(PROVIDER_UNAVAILABLE); }
  }
  async test(): Promise<void> {
    const value = await this.complete([{ role: 'system', content: 'Return only valid JSON.' }, { role: 'user', content: 'Return exactly {"ok":true}.' }], 512);
    if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) throw new AgentProviderError(PROVIDER_UNAVAILABLE);
  }
  async next(context: AgentContext, feedback?: string): Promise<unknown> {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildContextMessage(context) }];
    if (feedback) messages.push({ role: 'user', content: `Corrige la salida: ${feedback}` });
    const value = await this.complete(messages, 2048);
    if (value && typeof value === 'object' && (value as { type?: string }).type === 'draft') {
      const draft = value as { timeSpec: Parameters<typeof createTimeSpec>[0] };
      try { draft.timeSpec = createTimeSpec(draft.timeSpec); } catch { throw new AgentProviderError(PROVIDER_UNAVAILABLE); }
    }
    return value;
  }
}
