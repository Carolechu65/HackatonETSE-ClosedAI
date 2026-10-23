export type AiProviderId = 'openrouter' | 'openai' | 'opencode' | 'deepseek';
export type AiProviderChoice = { id: AiProviderId; name: string; models: string[] };
export type AiConnection = { provider: AiProviderId; model: string; maskedKey: string; verifiedAt: number };
export type AiStatus = { available: boolean; connection: AiConnection | null; providers: AiProviderChoice[] };
export type AiConnectionInput = { provider: AiProviderId; model: string; apiKey: string };
