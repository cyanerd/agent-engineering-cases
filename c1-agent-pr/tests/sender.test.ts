import { describe, expect, it } from 'vitest';
import { createCodeSender } from '../src/sender.ts';
import { FakeProvider } from './fake-provider.ts';

describe('code sender', () => {
  it('sends the code through the first provider', async () => {
    const alpha = new FakeProvider('alpha');
    const beta = new FakeProvider('beta');
    const r = await createCodeSender({ providers: [alpha, beta], retries: 2, timeoutMs: 200 }).sendCode('+79000000001', '123456', 'req-1');
    expect(r.provider).toBe('alpha');
    expect(alpha.calls[0]?.text).toContain('123456');
    expect(beta.calls).toHaveLength(0);
  });

  it('falls back to the second provider when the first keeps failing', async () => {
    const alpha = new FakeProvider('alpha', [{ status: 500 }]);
    const beta = new FakeProvider('beta');
    const r = await createCodeSender({ providers: [alpha, beta], retries: 2, timeoutMs: 200 }).sendCode('+79000000001', '123456', 'req-2');
    expect(r.provider).toBe('beta');
  });

  it('retries a 500 and succeeds', async () => {
    const alpha = new FakeProvider('alpha', [{ status: 500 }, 'ok']);
    const r = await createCodeSender({ providers: [alpha], retries: 2, timeoutMs: 200 }).sendCode('+79000000001', '123456', 'req-3');
    expect(r.provider).toBe('alpha');
    expect(alpha.calls).toHaveLength(2);
  });
});
