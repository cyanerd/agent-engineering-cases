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
