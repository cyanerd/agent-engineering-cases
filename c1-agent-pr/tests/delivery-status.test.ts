import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodeSender } from '../src/sender.ts';
import { gammaSms } from '../src/providers/gamma.ts';
import type { SmsProvider } from '../src/types.ts';
import { FakeProvider } from './fake-provider.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSender(providers: SmsProvider[] = [new FakeProvider('alpha')]) {
  return createCodeSender({ providers, retries: 1, timeoutMs: 200 });
}

describe('gamma-sms provider', () => {
  it('posts JSON to the v2 messages endpoint', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ id: 'gamma-msg-1' }), { status: 200 });
      }),
    );

    const provider = gammaSms('gamma-token');
    const result = await provider.send({ to: '+79000000001', text: 'hello', idempotencyKey: 'code-req-1' }, new AbortController().signal);

    expect(provider.name).toBe('gamma-sms');
    expect(result.id).toBe('gamma-msg-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.gamma-sms.test/v2/messages');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer gamma-token',
      'idempotency-key': 'code-req-1',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ to: '+79000000001', text: 'hello' });
  });

  it('propagates retriable gateway errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));

    await expect(
      gammaSms('gamma-token').send({ to: '+79000000001', text: 'hello', idempotencyKey: 'code-req-2' }, new AbortController().signal),
    ).rejects.toMatchObject({ retriable: true, status: 503 });
  });

  it('sends a code and tracks its delivery status end to end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'gamma-msg-3' }), { status: 200 })),
    );

    const sender = createCodeSender({ providers: [gammaSms('gamma-token')], retries: 0, timeoutMs: 200 });
    const sent = await sender.sendCode('+79000000001', '123456', 'req-gamma');

    expect(sent).toEqual({ provider: 'gamma-sms', id: 'gamma-msg-3' });
    expect(sender.getDeliveryStatus('req-gamma')).toMatchObject({
      requestId: 'req-gamma',
      provider: 'gamma-sms',
      messageId: 'gamma-msg-3',
      status: 'pending',
    });

    const updated = sender.handleDeliveryCallback('gamma-sms', { id: 'gamma-msg-3', status: 'delivered' });

    expect(updated?.status).toBe('delivered');
    expect(sender.getDeliveryStatus('req-gamma')?.status).toBe('delivered');
  });
});

describe('delivery status', () => {
  it('starts as pending after a successful send', async () => {
    const sender = makeSender();
    const sent = await sender.sendCode('+79000000001', '123456', 'req-pending');

    const status = sender.getDeliveryStatus('req-pending');
    expect(status).toMatchObject({
      requestId: 'req-pending',
      provider: 'alpha',
      messageId: sent.id,
      status: 'pending',
    });
    expect(status?.updatedAt).toBeInstanceOf(Date);
  });

  it('reports delivered and failed callbacks by provider message id', async () => {
    const sender = makeSender();
    const sent = await sender.sendCode('+79000000001', '123456', 'req-callback');

    expect(sender.handleDeliveryCallback('alpha', { id: sent.id, status: 'delivered' })?.status).toBe('delivered');
    expect(sender.getDeliveryStatus('req-callback')?.status).toBe('delivered');

    expect(sender.handleDeliveryCallback('alpha', { id: sent.id, status: 'failed' })?.status).toBe('failed');
    expect(sender.getDeliveryStatus('req-callback')?.status).toBe('failed');
  });

  it('returns undefined for an unknown requestId', () => {
    expect(makeSender().getDeliveryStatus('missing')).toBeUndefined();
  });

  it('ignores callbacks for an unknown provider or message', async () => {
    const sender = makeSender();
    const sent = await sender.sendCode('+79000000001', '123456', 'req-unknown');

    expect(sender.handleDeliveryCallback('beta', { id: sent.id, status: 'delivered' })).toBeUndefined();
    expect(sender.handleDeliveryCallback('alpha', { id: 'unknown-id', status: 'delivered' })).toBeUndefined();
    expect(sender.getDeliveryStatus('req-unknown')?.status).toBe('pending');
  });

  it('matches callbacks within the reporting provider only', async () => {
    const fixedId = async () => ({ id: 'shared-id' });
    const alpha = { name: 'alpha', send: fixedId };
    const beta = { name: 'beta', send: fixedId };
    const sender = makeSender([alpha, beta]);
    await sender.sendCode('+79000000001', '123456', 'req-scoped');

    expect(sender.handleDeliveryCallback('beta', { id: 'shared-id', status: 'delivered' })).toBeUndefined();
    expect(sender.getDeliveryStatus('req-scoped')?.status).toBe('pending');

    expect(sender.handleDeliveryCallback('alpha', { id: 'shared-id', status: 'delivered' })?.status).toBe('delivered');
  });

  it('rejects malformed callbacks', () => {
    const sender = makeSender();

    expect(() => sender.handleDeliveryCallback('alpha', null)).toThrow('callback body must be an object');
    expect(() => sender.handleDeliveryCallback('alpha', [])).toThrow('callback body must be an object');
    expect(() => sender.handleDeliveryCallback('alpha', { id: '', status: 'delivered' })).toThrow('non-empty string "id"');
    expect(() => sender.handleDeliveryCallback('alpha', { status: 'delivered' })).toThrow('non-empty string "id"');
    expect(() => sender.handleDeliveryCallback('alpha', { id: 'x', status: 'sent' })).toThrow('"delivered" or "failed"');
  });

  it('does not let callers mutate the tracked status through a snapshot', async () => {
    const sender = makeSender();
    await sender.sendCode('+79000000001', '123456', 'req-snapshot');

    const status = sender.getDeliveryStatus('req-snapshot');
    if (status) status.status = 'failed';

    expect(sender.getDeliveryStatus('req-snapshot')?.status).toBe('pending');
  });

  it('keeps the status across an idempotent resend without sending again', async () => {
    const alpha = new FakeProvider('alpha');
    const sender = makeSender([alpha]);
    const first = await sender.sendCode('+79000000001', '123456', 'req-idempotent');
    sender.handleDeliveryCallback('alpha', { id: first.id, status: 'delivered' });

    const second = await sender.sendCode('+79000000001', '123456', 'req-idempotent');

    expect(second).toEqual(first);
    expect(alpha.calls).toHaveLength(1);
    expect(sender.getDeliveryStatus('req-idempotent')?.status).toBe('delivered');
  });

  it('does not track a send that failed', async () => {
    const sender = makeSender([new FakeProvider('alpha', [{ status: 400 }])]);

    await expect(sender.sendCode('+79000000001', '123456', 'req-failed')).rejects.toBeInstanceOf(Error);
    expect(sender.getDeliveryStatus('req-failed')).toBeUndefined();
  });
});
