import type { DispatchResult } from './types.ts';

/** Remembers completed sends for a while so that a client retry does not trigger a second SMS. */
export class DeliveryLedger {
  private readonly done = new Map<string, { result: DispatchResult; expiresAt: number }>();

  constructor(private readonly ttlMs = 10 * 60_000, private readonly now: () => number = () => Date.now()) {}

  get(requestId: string): DispatchResult | undefined {
    const e = this.done.get(requestId);
    if (!e) return undefined;
    if (e.expiresAt < this.now()) {
      this.done.delete(requestId);
      return undefined;
    }
    return e.result;
  }

  record(requestId: string, result: DispatchResult): void {
    this.done.set(requestId, { result, expiresAt: this.now() + this.ttlMs });
  }

  get size(): number {
    return this.done.size;
  }
}
