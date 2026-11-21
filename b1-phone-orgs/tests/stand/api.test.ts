import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type Api } from '../../src/api.ts';
import { smsLogin } from '../../src/kc.ts';
import { seedPerson } from '../../src/seed.ts';

let naive: Api, fixed: Api;
const call = (api: Api, path: string, token?: string) => fetch(`${api.url}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(async () => {
  naive = await startApi('naive', 0);
  fixed = await startApi('fixed', 0);
  for (const mode of ['naive', 'fixed'] as const) await seedPerson(mode, { name: 'Борис', phone: '+79000000801', orgs: ['A', 'B'], device: 'boris-phone' });
});
afterAll(async () => {
  await naive.close();
  await fixed.close();
});

describe('API auth', () => {
  it('no token → 401', async () => {
    expect((await call(fixed, '/orgs/A/data')).status).toBe(401);
    expect((await call(naive, '/orgs/A/data')).status).toBe(401);
  });
  it('a token from the other realm → 401', async () => {
    const t = await smsLogin('naive', '+79000000801');
    expect(t.ok).toBe(true);
    if (t.ok) expect((await call(fixed, '/orgs/A/data', t.accessToken)).status).toBe(401);
  });
  it('fixed: a member gets the company data, a non-member gets 403', async () => {
    const t = await smsLogin('fixed', '+79000000801', 'boris-phone');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect((await call(fixed, '/orgs/A/data', t.accessToken)).status).toBe(200);
    expect((await call(fixed, '/orgs/B/data', t.accessToken)).status).toBe(200);
    expect((await call(fixed, '/orgs/C/data', t.accessToken)).status).toBe(403);
  });
  it('fixed: a second person with the same phone cannot be created', async () => {
    await expect(seedPerson('fixed', { name: 'Двойник', phone: '+79000000801', orgs: ['C'], device: 'x' })).rejects.toThrow(/409/);
  });
});
