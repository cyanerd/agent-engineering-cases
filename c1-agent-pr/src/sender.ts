import { DeliveryTracker, parseDeliveryCallback } from './delivery.ts';
import { ProviderError, type DeliveryState, type SendResult, type SmsMessage, type SmsProvider } from './types.ts';

export interface SenderOptions {
  /** Tried in this order; the next one only after the previous exhausted its retries on retriable errors. */
  providers: SmsProvider[];
  /** Extra attempts per provider on retriable errors (5xx, 429, timeout). */
  retries: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
}

export interface CodeSender {
  sendCode(to: string, code: string, requestId: string): Promise<SendResult>;
  /**
   * Entry point for a provider delivery callback. Accepts the raw callback body,
   * applies a valid receipt and returns whether it matched a sent message.
   * Throws DeliveryCallbackError for a malformed body.
   */
  handleDeliveryCallback(payload: unknown): boolean;
  /** `'pending'` until the provider reports delivery, `undefined` for an unknown requestId. */
  deliveryStatus(requestId: string): DeliveryState | undefined;
}

/**
 * Sends one-time codes. Guarantees:
 * - one logical send per requestId: a repeated sendCode with the same requestId returns the first result, no new SMS;
 * - every attempt of one send carries the same idempotency key, so a gateway that already got it does not send twice;
 * - non-retriable errors (4xx: bad number, blocked sender) stop immediately, no retry and no fallback;
 * - providers are used strictly in the configured order;
 * - delivery receipts are matched back to the requestId of the send that produced the provider message.
 */
export function createCodeSender(opts: SenderOptions): CodeSender {
  const inFlight = new Map<string, Promise<SendResult>>();
  const delivery = new DeliveryTracker();

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

  async function deliver(msg: SmsMessage): Promise<SendResult> {
    let last: unknown;
    for (const p of opts.providers) {
      for (let i = 0; i <= opts.retries; i++) {
        try {
          const r = await attempt(p, msg);
          return { provider: p.name, id: r.id };
        } catch (e) {
          last = e;
          if (e instanceof ProviderError && !e.retriable) throw e;
          if (!(e instanceof ProviderError)) break;
        }
      }
    }
    throw new Error(`all providers failed: ${String((last as Error)?.message ?? last)}`);
  }

  function sendCode(to: string, code: string, requestId: string): Promise<SendResult> {
    const existing = inFlight.get(requestId);
    if (existing) return existing;
    const p = deliver({ to, text: `Код входа: ${code}. Никому его не сообщайте.`, idempotencyKey: `code-${requestId}` }).then((result) => {
      delivery.track(requestId, result);
      return result;
    });
    inFlight.set(requestId, p);
    p.catch(() => inFlight.delete(requestId));
    return p;
  }

  return {
    sendCode,
    handleDeliveryCallback(payload: unknown): boolean {
      return delivery.apply(parseDeliveryCallback(payload));
    },
    deliveryStatus(requestId: string): DeliveryState | undefined {
      return delivery.statusOf(requestId);
    },
  };
}
