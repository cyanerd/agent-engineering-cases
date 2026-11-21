/**
 * Six "one phone - five companies" scenarios, each on the naive and the fixed model, through the real
 * Keycloak and the real API. Naive must misbehave (repro), fixed must behave. Observations go to results/scenarios.json.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_HEADERS, startApi, type Api } from '../../src/api.ts';
import { pool, publishVersion } from '../../src/db.ts';
import { setEnabled, smsLogin, type TokenResult } from '../../src/kc.ts';
import { seedPerson } from '../../src/seed.ts';

const ORGS = ['A', 'B', 'C', 'D', 'E'];
let api: Record<'naive' | 'fixed', Api>;
const results: { id: string; title: string; naive: string; fixed: string }[] = [];
const note = (id: string, title: string, naive: string, fixed: string) => results.push({ id, title, naive, fixed });

const get = (mode: 'naive' | 'fixed', path: string, token: string) => fetch(`${api[mode].url}${path}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);
const post = (mode: 'naive' | 'fixed', path: string, token?: string, body: unknown = {}) =>
  fetch(`${api[mode].url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : ADMIN_HEADERS) }, body: JSON.stringify(body) }).then((r) => r.status);
const accept = (mode: 'naive' | 'fixed', org: string, token: string, version: number) => post(mode, `/orgs/${org}/consents/payments-terms/accept`, token, { version });
const latest = async () => (await pool.query(`SELECT max(version) AS v FROM document_versions WHERE document_id = 'payments-terms'`)).rows[0].v as number;
const token = (r: TokenResult) => {
  if (!r.ok) throw new Error(`login failed: ${r.error}`);
  return r.accessToken;
};
const reachable = async (mode: 'naive' | 'fixed', t: string) => {
  const out: string[] = [];
  for (const o of ORGS) if ((await get(mode, `/orgs/${o}/data`, t)) === 200) out.push(o);
  return out;
};

beforeAll(async () => {
  api = { naive: await startApi('naive', 0), fixed: await startApi('fixed', 0) };
});
afterAll(async () => {
  await api.naive.close();
  await api.fixed.close();
  writeFileSync(new URL('../../results/scenarios.json', import.meta.url), `${JSON.stringify(results, null, 2)}\n`);
});

describe('S1. Sign-in by phone: who gets in?', () => {
  it('naive lands in one arbitrary company account; fixed signs in the person who works in all five', async () => {
    for (const mode of ['naive', 'fixed'] as const) await seedPerson(mode, { name: 'Анна', phone: '+79000000101', orgs: ORGS, device: 'anna-phone' });
    const n = await reachable('naive', token(await smsLogin('naive', '+79000000101', 'anna-phone')));
    const f = await reachable('fixed', token(await smsLogin('fixed', '+79000000101', 'anna-phone')));
    note('S1', 'Вход по номеру, человек в 5 компаниях', `вошла в учётку одной из компаний (какой - решает порядок строк в базе Keycloak), остальные 4 недоступны`, `вошла как человек, доступны ${f.join(',')}`);
    expect(n).toHaveLength(1);
    expect(f).toEqual(ORGS);
  });
});

describe('S2. Fired from A, still employed in B', () => {
  it('naive keeps A open with a token issued before firing; fixed closes A on the next request and keeps B', async () => {
    const n = await seedPerson('naive', { name: 'Вера', phone: '+79000000201', orgs: ['A', 'B'], device: 'vera-phone' });
    const f = await seedPerson('fixed', { name: 'Вера', phone: '+79000000201', orgs: ['A', 'B'], device: 'vera-phone' });
    const nt = token(await smsLogin('naive', '+79000000201', 'vera-phone'));
    const ft = token(await smsLogin('fixed', '+79000000201', 'vera-phone'));
    const nOrg = (await reachable('naive', nt))[0]!;
    expect(await post('naive', `/admin/orgs/${nOrg}/members/${n.usersByOrg[nOrg]}/fire`)).toBe(204);
    expect(await post('fixed', `/admin/orgs/A/members/${f.personId}/fire`)).toBe(204);
    const nAfter = await get('naive', `/orgs/${nOrg}/data`, nt);
    const fA = await get('fixed', '/orgs/A/data', ft);
    const fB = await get('fixed', '/orgs/B/data', ft);
    note('S2', 'Уволена из A, осталась в Б', `после увольнения из ${nOrg} старый токен открывает ${nOrg}: HTTP ${nAfter}`, `A: HTTP ${fA}, Б: HTTP ${fB} тем же токеном`);
    expect(nAfter).toBe(200);
    expect([fA, fB]).toEqual([403, 200]);
  });
});

describe('S3. Consent accepted in A', () => {
  it('naive counts it in B as well; fixed asks B to accept separately', async () => {
    const n = await seedPerson('naive', { name: 'Глеб', phone: '+79000000301', orgs: ['A', 'B'], device: 'gleb-phone' });
    await seedPerson('fixed', { name: 'Глеб', phone: '+79000000301', orgs: ['A', 'B'], device: 'gleb-phone' });
    // naive: accept in the company the login landed in, then that account is switched off and the next login lands in the other one
    const nt1 = token(await smsLogin('naive', '+79000000301', 'gleb-phone'));
    const first = (await reachable('naive', nt1))[0]!;
    const other = first === 'A' ? 'B' : 'A';
    expect(await accept('naive', first, nt1, await latest())).toBe(204);
    await setEnabled('naive', n.usersByOrg[first]!, false);
    const nt2 = token(await smsLogin('naive', '+79000000301', 'gleb-phone'));
    const nOther = await get('naive', `/orgs/${other}/payments`, nt2);
    const ft = token(await smsLogin('fixed', '+79000000301', 'gleb-phone'));
    expect(await accept('fixed', 'A', ft, await latest())).toBe(204);
    const fA = await get('fixed', '/orgs/A/payments', ft);
    const fB = await get('fixed', '/orgs/B/payments', ft);
    note('S3', 'Согласие, принятое в A, и компания Б', `принято в ${first}, в ${other} засчитано без принятия: HTTP ${nOther}`, `A: HTTP ${fA}, Б требует принять: HTTP ${fB}`);
    expect(nOther).toBe(200);
    expect([fA, fB]).toEqual([200, 428]);
  });
});

describe('S5. The phone number was given to someone else by the operator', () => {
  it('naive lets the new owner into the old account; fixed requires a second factor on a new device', async () => {
    for (const mode of ['naive', 'fixed'] as const) await seedPerson(mode, { name: 'Дина', phone: '+79000000501', orgs: ['C'], device: 'dina-phone', verifiedDaysAgo: 200 });
    const n = await smsLogin('naive', '+79000000501', 'new-sim');
    const f = await smsLogin('fixed', '+79000000501', 'new-sim');
    const fOwner = await smsLogin('fixed', '+79000000501', 'dina-phone');
    const nData = n.ok ? await get('naive', '/orgs/C/data', n.accessToken) : 0;
    note('S5', 'Номер переназначен оператором', `новый владелец номера вошёл и открыл данные C: HTTP ${nData}`, `новое устройство: ${f.ok ? 'вход' : f.error}; прежний владелец со своего устройства: ${fOwner.ok ? 'вход' : fOwner.error}`);
    expect(nData).toBe(200);
    expect(f).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(fOwner.ok).toBe(true);
  });
});

describe('S6. A second person with the same phone', () => {
  it('naive accepts the duplicate and both people sign in as the same account; fixed refuses to create it', async () => {
    const egor = await seedPerson('naive', { name: 'Егор', phone: '+79000000601', orgs: ['D'], device: 'egor-phone' });
    const zhanna = await seedPerson('naive', { name: 'Жанна', phone: '+79000000601', orgs: ['E'], device: 'zhanna-phone' });
    const a = await smsLogin('naive', '+79000000601', 'egor-phone');
    const b = await smsLogin('naive', '+79000000601', 'zhanna-phone');
    const subA = a.ok ? String(a.claims.sub) : '';
    const subB = b.ok ? String(b.claims.sub) : '';
    const owner = subA === egor.usersByOrg.D ? 'Егор (D)' : subA === zhanna.usersByOrg.E ? 'Жанна (E)' : '?';
    await seedPerson('fixed', { name: 'Егор', phone: '+79000000601', orgs: ['D'], device: 'egor-phone' });
    const dup = await seedPerson('fixed', { name: 'Жанна', phone: '+79000000601', orgs: ['E'], device: 'zhanna-phone' }).then(() => 'создан', (e: Error) => e.message.slice(0, 3));
    note('S6', 'Второй человек с тем же номером', `дубль создан; оба человека входят в одну и ту же учётку (${owner}), второй попадает в чужую компанию`, `заведение дубля: ${dup}; если дубль обошёл приложение, вход отвергается (ambiguous_phone)`);
    expect(subA).not.toBe('');
    expect(subA).toBe(subB);
    expect(dup).toBe('409');
  });
});

describe('S2b. Fired from A and later rehired', () => {
  it('fixed: a token issued before the firing stays dead after rehire; a new token works', async () => {
    const f = await seedPerson('fixed', { name: 'Лев', phone: '+79000000202', orgs: ['A'], device: 'lev-phone' });
    const old = token(await smsLogin('fixed', '+79000000202', 'lev-phone'));
    expect(await post('fixed', `/admin/orgs/A/members/${f.personId}/fire`)).toBe(204);
    expect(await post('fixed', `/admin/orgs/A/members/${f.personId}/rehire`)).toBe(204);
    const oldAfter = await get('fixed', '/orgs/A/data', old);
    await new Promise((r) => setTimeout(r, 6000)); // beyond the clock-skew margin
    const fresh = await get('fixed', '/orgs/A/data', token(await smsLogin('fixed', '+79000000202', 'lev-phone')));
    note('S2b', 'Уволен из A и снова принят', '-', `старый токен после повторного найма: HTTP ${oldAfter}; новый токен: HTTP ${fresh}`);
    expect([oldAfter, fresh]).toEqual([403, 200]);
  }, 30_000);
});

describe('S4. A new version of the consent document', () => {
  it('naive keeps the old acceptance; fixed asks to accept the new version', async () => {
    for (const mode of ['naive', 'fixed'] as const) await seedPerson(mode, { name: 'Илья', phone: '+79000000401', orgs: ['B'], device: 'ilya-phone' });
    const nt = token(await smsLogin('naive', '+79000000401', 'ilya-phone'));
    const ft = token(await smsLogin('fixed', '+79000000401', 'ilya-phone'));
    expect(await accept('naive', 'B', nt, await latest())).toBe(204);
    expect(await accept('fixed', 'B', ft, await latest())).toBe(204);
    const v = await publishVersion('payments-terms');
    const n = await get('naive', '/orgs/B/payments', nt);
    const fBefore = await get('fixed', '/orgs/B/payments', ft);
    expect(await accept('fixed', 'B', ft, v)).toBe(204);
    const fAfter = await get('fixed', '/orgs/B/payments', ft);
    note('S4', `Новая версия согласия (v${v})`, `старое «принято» действует: HTTP ${n}`, `до принятия v${v}: HTTP ${fBefore}, после: HTTP ${fAfter}`);
    expect(n).toBe(200);
    expect([fBefore, fAfter]).toEqual([428, 200]);
  });
});
