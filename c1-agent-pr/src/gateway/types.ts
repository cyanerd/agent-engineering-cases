import type { SmsMessage, SmsProvider } from '../types.ts';

/** A provider registered in the gateway with routing metadata. */
export interface RegisteredProvider {
  provider: SmsProvider;
  /** Lower is preferred when costs are equal. */
  priority: number;
  /** Price of one SMS in minor currency units; the gateway prefers cheaper routes. */
  costPerSms: number;
  /** Phone prefixes this route serves; empty = all. */
  prefixes: string[];
  enabled: boolean;
}

export interface DispatchContext {
  requestId: string;
  attempt: number;
  provider: string;
  startedAt: number;
}

export interface DispatchResult {
  provider: string;
  id: string;
  attempts: number;
  durationMs: number;
}

export interface GatewayHooks {
  onAttempt?(ctx: DispatchContext): void;
  onSuccess?(ctx: DispatchContext, result: DispatchResult): void;
  onFailure?(ctx: DispatchContext, error: unknown): void;
}

export type OutgoingMessage = Omit<SmsMessage, 'idempotencyKey'>;
