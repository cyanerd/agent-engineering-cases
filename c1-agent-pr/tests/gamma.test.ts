import { afterEach, describe, expect, it, vi } from 'vitest';
import { gammaSms } from '../src/providers/gamma.ts';
import { createCodeSender } from '../src/sender.ts';
import { ProviderError, type SmsMessage } from '../src/types.ts';
import { FakeProvider } from './fake-provider.ts';

const message: SmsMessage = { to: '+79000000001', text: 'hello', idempotencyKey: 'code-req-1' };
const signal = () => new AbortController().signal;

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const stub = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gamma-sms provider', () => {
  it('posts the message to the v2 gateway with auth and an idempotency key', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ id: 'gamma-1' }), { status: 200 }));

    const result = await gammaSms('secret').send(message, signal());

    expect(result).toEqual({ id: 'gamma-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.gamma-sms.test/v2/messages');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer secret',
      'idempotency-key': 'code-req-1',
    });
    expect(calls[0]!.init.body).toBe(JSON.stringify({ to: message.to, text: message.text }));
  });

  it('marks 5xx as retriable with the HTTP status', async () => {
    stubFetch(() => new Response('gateway down', { status: 503 }));

    const error = await gammaSms('secret').send(message, signal()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ retriable: true, status: 503 });
  });

  it('marks 4xx as non-retriable', async () => {
    stubFetch(() => new Response('bad number', { status: 400 }));

    const error = await gammaSms('secret').send(message, signal()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ retriable: false, status: 400 });
  });

  it('turns a network failure into a retriable error', async () => {
    stubFetch(() => {
      throw new Error('socket closed');
    });

    const error = await gammaSms('secret').send(message, signal()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ retriable: true });
    expect((error as Error).message).toContain('gamma-sms');
  });

  it('acts as the third fallback in the sender chain', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ id: 'gamma-req-3' }), { status: 200 }));
    const alpha = new FakeProvider('alpha-sms', [{ status: 500 }]);
    const beta = new FakeProvider('beta-sms', [{ status: 500 }]);
    const sender = createCodeSender({ providers: [alpha, beta, gammaSms('secret')], retries: 0, timeoutMs: 200 });

    const result = await sender.sendCode('+79000000001', '123456', 'req-3');

    expect(result).toEqual({ provider: 'gamma-sms', id: 'gamma-req-3' });
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.headers).toMatchObject({ 'idempotency-key': 'code-req-3' });
  });
});
