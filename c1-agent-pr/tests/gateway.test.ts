import { describe, expect, it } from 'vitest';
import { BreakerBank, CircuitBreaker, DeliveryLedger, Dispatcher, GatewayMetrics, ProviderRegistry, RetryPolicy, buildRegistry, routesFromEnv } from '../src/gateway/index.ts';
import { FakeProvider } from './fake-provider.ts';

const deps = (registry: ProviderRegistry, extra: Partial<ConstructorParameters<typeof Dispatcher>[0]> = {}) => ({
  registry,
  retry: RetryPolicy.fromRetries(2),
  breakers: new BreakerBank({ failureThreshold: 5, resetAfterMs: 1000 }),
  ledger: new DeliveryLedger(),
  timeoutMs: 100,
  sleep: async () => {},
  ...extra,
});

describe('ProviderRegistry', () => {
  it('orders routes by cost, then priority', () => {
    const r = new ProviderRegistry().register(new FakeProvider('a'), { costPerSms: 300 }).register(new FakeProvider('b'), { costPerSms: 100 }).register(new FakeProvider('c'), { costPerSms: 100, priority: -1 });
    expect(r.select('+7900').map((x) => x.provider.name)).toEqual(['c', 'b', 'a']);
  });
  it('filters by prefix and skips disabled routes', () => {
    const r = new ProviderRegistry().register(new FakeProvider('ru'), { prefixes: ['+7'] }).register(new FakeProvider('kz'), { prefixes: ['+77'] }).register(new FakeProvider('all'));
    r.disable('all');
    expect(r.select('+79001234567').map((x) => x.provider.name)).toEqual(['ru']);
    r.enable('all');
    expect(r.select('+77001234567').map((x) => x.provider.name)).toEqual(['ru', 'kz', 'all']);
  });
  it('rejects duplicate registration', () => {
    const r = new ProviderRegistry().register(new FakeProvider('a'));
    expect(() => r.register(new FakeProvider('a'))).toThrow(/already/);
  });
});

describe('RetryPolicy', () => {
  it('retries until maxAttempts', () => {
    const p = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 });
    expect([1, 2, 3].map((a) => p.shouldRetry(new Error('x'), a))).toEqual([true, true, false]);
  });
  it('backs off exponentially with a cap', () => {
    const p = new RetryPolicy({ maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 500 });
    expect([1, 2, 3, 4].map((a) => p.delayFor(a))).toEqual([100, 200, 400, 500]);
  });
  it('honours a custom retryOn', () => {
    const p = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, retryOn: () => false });
    expect(p.shouldRetry(new Error('x'), 1)).toBe(false);
  });
});

describe('CircuitBreaker', () => {
  it('opens after the threshold and half-opens after the reset time', () => {
    let t = 0;
    const b = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 100, now: () => t });
    b.failure();
    expect(b.allows()).toBe(true);
    b.failure();
    expect(b.current).toBe('open');
    t = 150;
    expect(b.current).toBe('half-open');
    b.success();
    expect(b.current).toBe('closed');
  });
});

describe('DeliveryLedger', () => {
  it('returns recorded results until they expire', () => {
    let t = 0;
    const l = new DeliveryLedger(1000, () => t);
    l.record('r', { provider: 'a', id: '1', attempts: 1, durationMs: 5 });
    expect(l.get('r')?.id).toBe('1');
    t = 2000;
    expect(l.get('r')).toBeUndefined();
  });
});

describe('Dispatcher', () => {
  it('sends through the best route and records metrics', async () => {
    const metrics = new GatewayMetrics();
    const a = new FakeProvider('a');
    const d = new Dispatcher(deps(new ProviderRegistry().register(a), { hooks: [metrics] }));
    const r = await d.dispatch({ to: '+79000000001', text: 'hi' }, 'req-1');
    expect(r).toMatchObject({ provider: 'a', attempts: 1 });
    expect(metrics.snapshot().a).toMatchObject({ attempts: 1, successes: 1 });
  });
  it('falls back after retries are exhausted', async () => {
    const d = new Dispatcher(deps(new ProviderRegistry().register(new FakeProvider('a', [{ status: 500 }])).register(new FakeProvider('b'))));
    expect((await d.dispatch({ to: '+79000000001', text: 'hi' }, 'req-2')).provider).toBe('b');
  });
  it('a completed request is answered from the ledger', async () => {
    const a = new FakeProvider('a');
    const d = new Dispatcher(deps(new ProviderRegistry().register(a)));
    await d.dispatch({ to: '+79000000001', text: 'hi' }, 'req-3');
    await d.dispatch({ to: '+79000000001', text: 'hi' }, 'req-3');
    expect(a.calls).toHaveLength(1);
  });
  it('skips a route whose breaker is open', async () => {
    const breakers = new BreakerBank({ failureThreshold: 1, resetAfterMs: 60_000 });
    breakers.for('a').failure();
    const b = new FakeProvider('b');
    const d = new Dispatcher(deps(new ProviderRegistry().register(new FakeProvider('a')).register(b), { breakers }));
    expect((await d.dispatch({ to: '+79000000001', text: 'hi' }, 'req-4')).provider).toBe('b');
  });
});

describe('config', () => {
  it('builds routes from SMS_ROUTES', () => {
    const routes = routesFromEnv({ SMS_ROUTES: JSON.stringify([{ name: 'alpha-sms', token: 't', costPerSms: 120 }, { name: 'beta-sms', token: 't', costPerSms: 90 }]) });
    expect(buildRegistry(routes).select('+79000000001').map((r) => r.provider.name)).toEqual(['beta-sms', 'alpha-sms']);
  });
  it('empty env gives no routes', () => {
    expect(routesFromEnv({})).toEqual([]);
  });
});
