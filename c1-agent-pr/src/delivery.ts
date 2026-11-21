import { DeliveryCallbackError, type DeliveryCallback, type DeliveryState, type DeliveryStatus, type SendResult } from './types.ts';

interface Tracked {
  provider: string;
  messageId: string;
  status?: DeliveryStatus;
}

const messageKey = (provider: string, messageId: string) => `${provider}\u0000${messageId}`;

/**
 * Maps a requestId to the provider message that carries its code and keeps the
 * latest delivery receipt for it. Callbacks arrive out of band and may be
 * duplicated or reordered, so applying a receipt is idempotent.
 */
export class DeliveryTracker {
  private readonly byRequest = new Map<string, Tracked>();
  private readonly requestByMessage = new Map<string, string>();

  /** Remembers which provider message belongs to a requestId. */
  track(requestId: string, result: SendResult): void {
    const previous = this.byRequest.get(requestId);
    if (previous) this.requestByMessage.delete(messageKey(previous.provider, previous.messageId));
    this.byRequest.set(requestId, { provider: result.provider, messageId: result.id });
    this.requestByMessage.set(messageKey(result.provider, result.id), requestId);
  }

  /** Applies a receipt; returns false when it belongs to no message we sent. */
  apply(callback: DeliveryCallback): boolean {
    const requestId = this.requestByMessage.get(messageKey(callback.provider, callback.id));
    if (requestId === undefined) return false;
    this.byRequest.get(requestId)!.status = callback.status;
    return true;
  }

  /** `'pending'` until a receipt arrives, `undefined` for a requestId that was never sent. */
  statusOf(requestId: string): DeliveryState | undefined {
    const tracked = this.byRequest.get(requestId);
    if (!tracked) return undefined;
    return tracked.status ?? 'pending';
  }
}

/** Validates an untrusted callback body (an HTTP webhook payload). Extra fields are ignored. */
export function parseDeliveryCallback(payload: unknown): DeliveryCallback {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new DeliveryCallbackError('delivery callback must be a JSON object');
  }
  const { provider, id, status } = payload as Record<string, unknown>;
  if (typeof provider !== 'string' || provider.length === 0) throw new DeliveryCallbackError('delivery callback: "provider" must be a non-empty string');
  if (typeof id !== 'string' || id.length === 0) throw new DeliveryCallbackError('delivery callback: "id" must be a non-empty string');
  if (status !== 'delivered' && status !== 'failed') throw new DeliveryCallbackError('delivery callback: "status" must be "delivered" or "failed"');
  return { provider, id, status };
}
