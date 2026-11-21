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

/** Terminal delivery receipt reported by a provider after the send was accepted. */
export type DeliveryStatus = 'delivered' | 'failed';

/** What is known about a sent code: a terminal receipt, or no receipt yet. */
export type DeliveryState = DeliveryStatus | 'pending';

/**
 * Delivery receipt delivered to the service by a provider callback.
 * `provider` and `id` are the same pair returned in SendResult, which is how a
 * receipt for one particular code is matched back to its requestId.
 */
export interface DeliveryCallback {
  provider: string;
  id: string;
  /** Receipts are terminal; the latest one is kept. */
  status: DeliveryStatus;
}

/** The callback payload is not a usable delivery receipt (non-retriable by the sender of the callback). */
export class DeliveryCallbackError extends Error {
  constructor(message: string) {
    super(message);
  }
}
