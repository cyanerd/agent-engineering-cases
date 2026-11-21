export interface SmsMessage {
  to: string;
  text: string;
  /** Same key for every attempt of one logical send: gateways deduplicate by it. */
  idempotencyKey: string;
}

export interface SmsProvider {
  readonly name: string;
  send(msg: SmsMessage, signal: AbortSignal): Promise<{ id: string }>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retriable: boolean, readonly status?: number) {
    super(message);
  }
}

export interface SendResult {
  provider: string;
  id: string;
}
