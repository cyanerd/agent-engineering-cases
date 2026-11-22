import { describe, expect, it } from 'vitest';
import { createCodeSender, type CodeSender } from '../src/sender.ts';
import { DeliveryCallbackError } from '../src/types.ts';
import { FakeProvider } from './fake-provider.ts';

function sender(...providers: FakeProvider[]): CodeSender {
  return createCodeSender({ providers, retries: 0, timeoutMs: 200 });
}

describe('delivery status', () => {
  it('is unknown before the send and pending until a receipt arrives', async () => {
    const s = sender(new FakeProvider('alpha'));

    expect(s.deliveryStatus('req-1')).toBeUndefined();
    const result = await s.sendCode('+79000000001', '123456', 'req-1');
    expect(result).toEqual({ provider: 'alpha', id: 'alpha-code-req-1' });
    expect(s.deliveryStatus('req-1')).toBe('pending');
  });

  it('reports delivered for the requestId behind the provider message id', async () => {
    const s = sender(new FakeProvider('alpha'));
    const result = await s.sendCode('+79000000001', '123456', 'req-1');

    expect(s.handleDeliveryCallback({ provider: result.provider, id: result.id, status: 'delivered' })).toBe(true);
    expect(s.deliveryStatus('req-1')).toBe('delivered');
  });

  it('reports failed', async () => {
    const s = sender(new FakeProvider('alpha'));
    const result = await s.sendCode('+79000000001', '123456', 'req-1');

    expect(s.handleDeliveryCallback({ provider: result.provider, id: result.id, status: 'failed' })).toBe(true);
    expect(s.deliveryStatus('req-1')).toBe('failed');
  });

  it('keeps the latest receipt when a provider corrects an earlier one', async () => {
    const s = sender(new FakeProvider('alpha'));
    const result = await s.sendCode('+79000000001', '123456', 'req-1');
    const callback = { provider: result.provider, id: result.id };

    s.handleDeliveryCallback({ ...callback, status: 'failed' });
    s.handleDeliveryCallback({ ...callback, status: 'delivered' });
    expect(s.deliveryStatus('req-1')).toBe('delivered');

    s.handleDeliveryCallback({ ...callback, status: 'delivered' });
    expect(s.deliveryStatus('req-1')).toBe('delivered');
  });

  it('ignores receipts for messages it never sent, leaving other codes untouched', async () => {
    const s = sender(new FakeProvider('alpha'));
    const result = await s.sendCode('+79000000001', '123456', 'req-1');

    expect(s.handleDeliveryCallback({ provider: 'alpha', id: 'alpha-code-other', status: 'delivered' })).toBe(false);
    expect(s.handleDeliveryCallback({ provider: 'beta', id: result.id, status: 'delivered' })).toBe(false);
    expect(s.deliveryStatus('req-1')).toBe('pending');
  });

  it('ignores a receipt from a provider that lost the fallback race', async () => {
    // alpha accepted the message but timed out, so beta carried the code.
    const alpha = new FakeProvider('alpha', ['timeout']);
    const beta = new FakeProvider('beta');
    const s = sender(alpha, beta);

    const result = await s.sendCode('+79000000001', '123456', 'req-1');
    expect(result).toEqual({ provider: 'beta', id: 'beta-code-req-1' });

    expect(s.handleDeliveryCallback({ provider: 'alpha', id: 'alpha-code-req-1', status: 'delivered' })).toBe(false);
    expect(s.deliveryStatus('req-1')).toBe('pending');

    expect(s.handleDeliveryCallback({ provider: 'beta', id: result.id, status: 'delivered' })).toBe(true);
    expect(s.deliveryStatus('req-1')).toBe('delivered');
  });

  it('keeps the status across repeated sendCode calls', async () => {
    const alpha = new FakeProvider('alpha');
    const s = sender(alpha);
    const first = await s.sendCode('+79000000001', '123456', 'req-1');
    s.handleDeliveryCallback({ provider: first.provider, id: first.id, status: 'delivered' });

    const second = await s.sendCode('+79000000001', '123456', 'req-1');

    expect(second).toEqual(first);
    expect(alpha.calls).toHaveLength(1);
    expect(s.deliveryStatus('req-1')).toBe('delivered');
  });

  it('has no status for a send that failed on every provider', async () => {
    const s = sender(new FakeProvider('alpha', [{ status: 500 }]));

    await expect(s.sendCode('+79000000001', '123456', 'req-1')).rejects.toThrow(/all providers failed/);
    expect(s.deliveryStatus('req-1')).toBeUndefined();
  });

  it('accepts extra fields in the callback body', async () => {
    const s = sender(new FakeProvider('alpha'));
    const result = await s.sendCode('+79000000001', '123456', 'req-1');

    expect(
      s.handleDeliveryCallback({ provider: result.provider, id: result.id, status: 'delivered', timestamp: '2026-11-21T10:00:00Z' }),
    ).toBe(true);
    expect(s.deliveryStatus('req-1')).toBe('delivered');
  });

  it('rejects malformed callback bodies', () => {
    const s = sender(new FakeProvider('alpha'));
    const invalid: unknown[] = [
      null,
      [],
      'delivered',
      {},
      { provider: 'alpha', id: 'm-1' },
      { provider: '', id: 'm-1', status: 'delivered' },
      { provider: 'alpha', id: 42, status: 'delivered' },
      { provider: 'alpha', id: 'm-1', status: 'sent' },
    ];

    for (const payload of invalid) {
      expect(() => s.handleDeliveryCallback(payload)).toThrow(DeliveryCallbackError);
    }
  });
});
