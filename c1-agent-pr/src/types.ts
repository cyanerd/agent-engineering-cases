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

/** Final delivery outcome reported by a gateway through its status callback. */
export type DeliveryStatus = 'delivered' | 'failed';

/** A send starts as pending and gets a final status once the gateway reports it. */
export type TrackedDeliveryStatus = 'pending' | DeliveryStatus;

/** What a gateway sends to the delivery callback: its message id plus the outcome. */
export interface DeliveryCallback {
  /** Provider-side message id returned by `send`. */
  id: string;
  status: DeliveryStatus;
}

/** Snapshot of a tracked send, looked up by the caller's requestId. */
export interface DeliveryStatusInfo {
  requestId: string;
  provider: string;
  messageId: string;
  status: TrackedDeliveryStatus;
  /** Time of the send for `pending`, or of the latest callback afterwards. */
  updatedAt: Date;
}

export class InvalidDeliveryCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDeliveryCallbackError';
  }
}
