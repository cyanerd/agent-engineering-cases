import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, readOutbox, requestCode, smsLogin, tokenBySms } from '../../src/kc.ts';

const now = new Date().toISOString();
const person = (phone: string) => ({ phone: [phone], phoneVerified: ['true'], phoneVerifiedAt: [now], knownDevices: ['device-1'] });
let id: string;

beforeAll(async () => {
  id = await createUser('fixed', `sms-test-${Date.now()}`, person('+79000000901'));
  await createUser('fixed', `sms-test2-${Date.now()}`, person('+79000000902'));
  await createUser('fixed', `sms-test3-${Date.now()}`, person('+79000000903'));
  await createUser('fixed', `sms-test4-${Date.now()}`, person('+79000000904'));
});

describe('SMS login through Keycloak', () => {
  it('issues a code and exchanges it for a token of that person', async () => {
    const r = await smsLogin('fixed', '+7 (900) 000-09-01');
    expect(r.ok && r.claims.sub).toBe(id);
  });
  it('a code works only once', async () => {
    expect(await requestCode('fixed', '+79000000902')).toBe(204);
    const code = await readOutbox('fixed', '+79000000902');
    expect((await tokenBySms('fixed', '+79000000902', code)).ok).toBe(true);
    expect(await tokenBySms('fixed', '+79000000902', code)).toMatchObject({ ok: false, error: 'invalid_grant' });
  });
  it('five wrong codes lock the phone even for the right code', async () => {
    await requestCode('fixed', '+79000000903');
    const code = await readOutbox('fixed', '+79000000903');
    for (let i = 0; i < 5; i++) await tokenBySms('fixed', '+79000000903', code === '000000' ? '111111' : '000000');
    expect(await tokenBySms('fixed', '+79000000903', code)).toMatchObject({ ok: false, error: 'too_many_attempts' });
  });
  it('the sixth code request in 10 minutes is refused', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push(await requestCode('fixed', '+79000000904'));
    expect(codes).toEqual([204, 204, 204, 204, 204, 429]);
  });
  it('an expired code is refused', async () => {
    const phone = '+79000000905';
    await createUser('fixed', `sms-test5-${Date.now()}`, person(phone));
    await requestCode('fixed', phone);
    const code = await readOutbox('fixed', phone);
    await new Promise((r) => setTimeout(r, (Number(process.env.SMS_CODE_TTL_SECONDS ?? 15) + 2) * 1000));
    expect(await tokenBySms('fixed', phone, code)).toMatchObject({ ok: false, error: 'invalid_grant' });
  }, 60_000);
  it('the outbox does not reveal whether a phone exists: unknown phone still gets 204', async () => {
    expect(await requestCode('fixed', '+79000000999')).toBe(204);
    expect(await smsLogin('fixed', '+79000000998')).toMatchObject({ ok: false, error: 'unknown_phone' });
  });
});

const WINDOW = Number(process.env.SMS_WINDOW_SECONDS ?? 20);
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

describe('review fixes', () => {
  it('the outbox is closed without an admin token', async () => {
    await requestCode('fixed', '+79000000910');
    await expect(readOutbox('fixed', '+79000000910', false)).rejects.toThrow(/401|403/);
  });

  it('parallel wrong guesses cannot get more than 5 checks', async () => {
    const phone = '+79000000911';
    await createUser('fixed', `sms-race-${Date.now()}`, person(phone));
    await requestCode('fixed', phone);
    const code = await readOutbox('fixed', phone);
    const wrong = code === '000000' ? '111111' : '000000';
    const rs = await Promise.all(Array.from({ length: 60 }, () => tokenBySms('fixed', phone, wrong)));
    const checked = rs.filter((r) => !r.ok && r.description === 'wrong code').length;
    expect(checked).toBeLessThanOrEqual(5);
    expect(await tokenBySms('fixed', phone, code)).toMatchObject({ ok: false, error: 'too_many_attempts' });
  });

  it('parallel exchanges of one code give exactly one token', async () => {
    const phone = '+79000000912';
    await createUser('fixed', `sms-once-${Date.now()}`, person(phone));
    await requestCode('fixed', phone);
    const code = await readOutbox('fixed', phone);
    const rs = await Promise.all(Array.from({ length: 20 }, () => tokenBySms('fixed', phone, code)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it('a duplicate that bypassed the app is refused at sign-in as ambiguous', async () => {
    const phone = '+79000000913';
    await createUser('fixed', `dup-a-${Date.now()}`, person(phone));
    await createUser('fixed', `dup-b-${Date.now()}`, person(phone));
    expect(await smsLogin('fixed', phone)).toMatchObject({ ok: false, error: 'ambiguous_phone' });
  });

  it('limits reset after the window: a locked phone and a throttled IP recover', async () => {
    const phone = '+79000000914';
    for (let i = 0; i < 5; i++) await tokenBySms('fixed', phone, '123456');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push(await requestCode('fixed', '+79000000915'));
    expect(codes.at(-1)).toBe(429);
    // per-IP budget: distinct phones from one address are throttled too
    let ipStatus = 204;
    for (let i = 0; i < 200 && ipStatus === 204; i++) ipStatus = await requestCode('fixed', `+7900001${String(i).padStart(4, '0')}`);
    expect(ipStatus).toBe(429);
    await wait(WINDOW * 2 + 2);
    expect(await requestCode('fixed', '+79000000915')).toBe(204);
    expect(await requestCode('fixed', '+79000019999')).toBe(204);
    await createUser('fixed', `sms-unlock-${Date.now()}`, person(phone));
    expect((await smsLogin('fixed', phone)).ok).toBe(true);
  }, 120_000);
});
