import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type Api } from '../../src/api.ts';
import { smsLogin, usersByPhone } from '../../src/kc.ts';
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

  it('fixed: accepting a consent names the version the person saw; a stale version is refused', async () => {
    const t = await smsLogin('fixed', '+79000000801', 'boris-phone');
    if (!t.ok) throw new Error(t.error);
    const accept = (version?: number) =>
      fetch(`${fixed.url}/orgs/A/consents/privacy/accept`, { method: 'POST', headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(version === undefined ? {} : { version }) }).then((r) => r.status);
    expect(await accept()).toBe(400);
    expect(await accept(999)).toBe(409);
    expect(await accept(1)).toBe(204);
  });
  it('fixed: concurrent creation of one phone leaves one person and one Keycloak user', async () => {
    const phone = '+79000000802';
    const rs = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => seedPerson('fixed', { name: `П${i}`, phone, orgs: ['C'], device: `d${i}` })));
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'rejected').every((r) => /409/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect(await usersByPhone('fixed', phone)).toHaveLength(1);
  });
});
