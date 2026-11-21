export type Provider = 'opencode' | 'ollama';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI Chat Completions message. Extra provider fields (e.g. reasoning_content) are preserved. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
  [extra: string]: unknown;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' } | { type: 'json_schema'; json_schema: unknown };
  /** Part of the cache key only: lets a caller take N independent samples of the same request. */
  sample?: number;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage: Usage;
  costUsd: number;
  /** For a cached result this is the latency of the original call. */
  latencyMs: number;
  cached: boolean;
  model: string;
}

/** USD per 1M tokens. */
export type PriceTable = Record<
  string,
  {
    input: number;
    cachedInput: number;
    output: number;
    peak?: { weekdaysUtc: string[]; hoursUtc: [string, string][]; factor: number };
  }
>;
