import { ProviderError, type SmsMessage, type SmsProvider } from '../src/types.ts';

export type Outcome = 'ok' | 'timeout' | { status: number };

/** In-memory provider: plays a script of outcomes and records every call. Deduplicates by idempotency key like real gateways. */
export class FakeProvider implements SmsProvider {
  readonly calls: SmsMessage[] = [];
  readonly delivered = new Map<string, SmsMessage>();
  private i = 0;
  constructor(readonly name: string, private readonly script: Outcome[] = ['ok']) {}

  async send(msg: SmsMessage, signal: AbortSignal): Promise<{ id: string }> {
    this.calls.push(msg);
    const o = this.script[Math.min(this.i++, this.script.length - 1)]!;
    if (o === 'timeout') {
      // The gateway accepted the message but answers too late: the SMS may still be delivered.
      this.delivered.set(msg.idempotencyKey, msg);
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new ProviderError(`${this.name}: aborted`, true))));
    }
    if (typeof o === 'object') throw new ProviderError(`${this.name}: HTTP ${o.status}`, o.status >= 500 || o.status === 429, o.status);
    this.delivered.set(msg.idempotencyKey, msg);
    return { id: `${this.name}-${msg.idempotencyKey}` };
  }
}
