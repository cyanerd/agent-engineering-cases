/**
 * Contract of the code sender, independent of its implementation: only createCodeSender and
 * recording fake providers are used. These are the properties a refactor of the provider layer must keep.
 */
import { describe, expect, it } from 'vitest';
import { createCodeSender } from '../src/sender.ts';
import { FakeProvider } from '../tests/fake-provider.ts';

const opts = (providers: FakeProvider[]) => ({ providers, retries: 2, timeoutMs: 50 });

describe('contract: code sender', () => {
  it('one requestId = one logical send: repeating sendCode makes no new provider calls', async () => {
    const a = new FakeProvider('alpha');
    const s = createCodeSender(opts([a]));
    await s.sendCode('+79000000001', '111111', 'r1');
    await s.sendCode('+79000000001', '111111', 'r1');
    expect(a.calls).toHaveLength(1);
  });

  it('concurrent sendCode with the same requestId sends once', async () => {
    const a = new FakeProvider('alpha');
    const s = createCodeSender(opts([a]));
    await Promise.all([s.sendCode('+79000000001', '1', 'r2'), s.sendCode('+79000000001', '1', 'r2')]);
    expect(a.calls).toHaveLength(1);
  });

  it('retries reuse the idempotency key: a gateway that already accepted the message does not deliver twice', async () => {
    const a = new FakeProvider('alpha', ['timeout', 'ok']);
    await createCodeSender(opts([a])).sendCode('+79000000001', '1', 'r3');
    expect(a.calls).toHaveLength(2);
    expect(new Set(a.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(a.delivered.size).toBe(1);
  });

  it('a non-retriable error (4xx) is not retried and does not fall back', async () => {
    const a = new FakeProvider('alpha', [{ status: 400 }]);
    const b = new FakeProvider('beta');
    await expect(createCodeSender(opts([a, b])).sendCode('+79000000001', '1', 'r4')).rejects.toThrow();
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
  });

  it('retriable errors are retried exactly `retries` times before falling back, in the configured order', async () => {
    const a = new FakeProvider('alpha', [{ status: 503 }]);
    const b = new FakeProvider('beta', [{ status: 502 }]);
    const c = new FakeProvider('gamma');
    const r = await createCodeSender(opts([a, b, c])).sendCode('+79000000001', '1', 'r5');
    expect([a.calls.length, b.calls.length, c.calls.length]).toEqual([3, 3, 1]);
    expect(r.provider).toBe('gamma');
  });

  it('a failed send can be retried by the caller with the same requestId', async () => {
    const a = new FakeProvider('alpha', [{ status: 500 }, { status: 500 }, { status: 500 }, 'ok']);
    const s = createCodeSender(opts([a]));
    await expect(s.sendCode('+79000000001', '1', 'r6')).rejects.toThrow();
    await expect(s.sendCode('+79000000001', '1', 'r6')).resolves.toMatchObject({ provider: 'alpha' });
  });

  it('time is bounded: a hanging gateway costs at most (retries+1) x timeout per provider', async () => {
    const a = new FakeProvider('alpha', ['timeout']);
    const b = new FakeProvider('beta');
    const started = Date.now();
    await createCodeSender(opts([a, b])).sendCode('+79000000001', '1', 'r7');
    expect(Date.now() - started).toBeLessThan(3 * 50 + 150);
  });

  it('the code text contains the code and nothing from another request', async () => {
    const a = new FakeProvider('alpha');
    const s = createCodeSender(opts([a]));
    await s.sendCode('+79000000001', '424242', 'r8');
    await s.sendCode('+79000000002', '737373', 'r9');
    expect(a.calls.map((c) => [c.to, c.text.includes('424242'), c.text.includes('737373')])).toEqual([['+79000000001', true, false], ['+79000000002', false, true]]);
  });
});
