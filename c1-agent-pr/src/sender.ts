import {
  InvalidDeliveryCallbackError,
  ProviderError,
  type DeliveryCallback,
  type DeliveryStatusInfo,
  type SendResult,
  type SmsMessage,
  type SmsProvider,
} from './types.ts';

export interface SenderOptions {
  /** Tried in this order; the next one only after the previous exhausted its retries on retriable errors. */
  providers: SmsProvider[];
  /** Extra attempts per provider on retriable errors (5xx, 429, timeout). */
  retries: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
}

/** Parses the untrusted callback body accepted from a gateway. */
function parseDeliveryCallback(payload: unknown): DeliveryCallback {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidDeliveryCallbackError('callback body must be an object');
  }
  const { id, status } = payload as Record<string, unknown>;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new InvalidDeliveryCallbackError('callback body must contain a non-empty string "id"');
  }
  if (status !== 'delivered' && status !== 'failed') {
    throw new InvalidDeliveryCallbackError('callback "status" must be "delivered" or "failed"');
  }
  return { id: id.trim(), status };
}

/**
 * Sends one-time codes. Guarantees:
 * - one logical send per requestId: a repeated sendCode with the same requestId returns the first result, no new SMS;
 * - every attempt of one send carries the same idempotency key, so a gateway that already got it does not send twice;
 * - non-retriable errors (4xx: bad number, blocked sender) stop immediately, no retry and no fallback;
 * - providers are used strictly in the configured order.
 *
 * Delivery status is tracked in memory by requestId. A send starts as `pending`; a gateway can later
 * report `delivered` or `failed` by its message id. Callbacks for unknown providers or messages are ignored.
 * Callers are responsible for authenticating the callback transport (for example, a webhook signature).
 */
export function createCodeSender(opts: SenderOptions) {
  const inFlight = new Map<string, Promise<SendResult>>();
  const statusByRequest = new Map<string, DeliveryStatusInfo>();
  /** `${provider}\0${messageId}` -> requestId. */
  const requestByMessage = new Map<string, string>();
  const providerNames = new Set(opts.providers.map((p) => p.name));

  function messageKey(provider: string, messageId: string): string {
    return `${provider}\u0000${messageId}`;
  }

  function remember(requestId: string, result: SendResult): void {
    statusByRequest.set(requestId, {
      requestId,
      provider: result.provider,
      messageId: result.id,
      status: 'pending',
      updatedAt: new Date(),
    });
    if (result.id !== '') requestByMessage.set(messageKey(result.provider, result.id), requestId);
  }

  function snapshot(info: DeliveryStatusInfo): DeliveryStatusInfo {
    return { ...info, updatedAt: new Date(info.updatedAt) };
  }

  async function attempt(p: SmsProvider, msg: SmsMessage): Promise<{ id: string }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
    try {
      return await p.send(msg, ac.signal);
    } catch (e) {
      if (ac.signal.aborted) throw new ProviderError(`${p.name}: timeout after ${opts.timeoutMs} ms`, true);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function deliver(msg: SmsMessage, requestId: string): Promise<SendResult> {
    let last: unknown;
    for (const p of opts.providers) {
      for (let i = 0; i <= opts.retries; i++) {
        try {
          const r = await attempt(p, msg);
          const result = { provider: p.name, id: r.id };
          remember(requestId, result);
          return result;
        } catch (e) {
          last = e;
          if (e instanceof ProviderError && !e.retriable) throw e;
          if (!(e instanceof ProviderError)) break;
        }
      }
    }
    throw new Error(`all providers failed: ${String((last as Error)?.message ?? last)}`);
  }

  return {
    sendCode(to: string, code: string, requestId: string): Promise<SendResult> {
      const existing = inFlight.get(requestId);
      if (existing) return existing;
      const p = deliver({ to, text: `Код входа: ${code}. Никому его не сообщайте.`, idempotencyKey: `code-${requestId}` }, requestId);
      inFlight.set(requestId, p);
      p.catch(() => inFlight.delete(requestId));
      return p;
    },

    /**
     * Accepts a provider callback. `provider` is the configured provider name (trusted: taken from
     * the webhook route), `payload` is the untrusted JSON body `{ id, status }`.
     * Returns the updated record, or undefined when the provider/message is not tracked.
     * Throws InvalidDeliveryCallbackError when the payload is malformed.
     */
    handleDeliveryCallback(provider: string, payload: unknown): DeliveryStatusInfo | undefined {
      const callback = parseDeliveryCallback(payload);
      if (!providerNames.has(provider)) return undefined;
      const requestId = requestByMessage.get(messageKey(provider, callback.id));
      if (requestId === undefined) return undefined;
      const current = statusByRequest.get(requestId);
      if (current === undefined) return undefined;
      const updated: DeliveryStatusInfo = { ...current, status: callback.status, updatedAt: new Date() };
      statusByRequest.set(requestId, updated);
      return snapshot(updated);
    },

    /** Returns the latest known status for a code sent with this requestId, or undefined. */
    getDeliveryStatus(requestId: string): DeliveryStatusInfo | undefined {
      const info = statusByRequest.get(requestId);
      return info === undefined ? undefined : snapshot(info);
    },
  };
}
