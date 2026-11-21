/** Thin Keycloak client for the stand: admin API, SMS endpoints, direct grant by phone + code. */
export const KC = process.env.KC_URL ?? 'http://localhost:18080';

let adminCache: { token: string; until: number } | undefined;
export async function adminToken(): Promise<string> {
  if (adminCache && adminCache.until > Date.now()) return adminCache.token;
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin-stand-only' }),
  });
  if (!r.ok) throw new Error(`admin token ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  adminCache = { token: j.access_token, until: Date.now() + (j.expires_in - 10) * 1000 };
  return j.access_token;
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${KC}/admin/realms/${path}`, { ...init, headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

export async function createUser(realm: string, username: string, attributes: Record<string, string[]>): Promise<string> {
  const r = await admin(`${realm}/users`, { method: 'POST', body: JSON.stringify({ username, enabled: true, attributes }) });
  if (r.status !== 201) throw new Error(`create user ${r.status} ${await r.text()}`);
  return r.headers.get('location')!.split('/').pop()!;
}

export async function setUserAttributes(realm: string, id: string, attributes: Record<string, string[]>): Promise<void> {
  const cur = (await (await admin(`${realm}/users/${id}`)).json()) as { attributes?: Record<string, string[]> };
  const r = await admin(`${realm}/users/${id}`, { method: 'PUT', body: JSON.stringify({ attributes: { ...(cur.attributes ?? {}), ...attributes } }) });
  if (!r.ok) throw new Error(`update user ${r.status} ${await r.text()}`);
}

export async function setEnabled(realm: string, id: string, enabled: boolean): Promise<void> {
  const r = await admin(`${realm}/users/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error(`enable user ${r.status}`);
}

export async function logoutUser(realm: string, id: string): Promise<void> {
  const r = await admin(`${realm}/users/${id}/logout`, { method: 'POST' });
  if (!r.ok) throw new Error(`logout ${r.status}`);
}

export async function requestCode(realm: string, phone: string): Promise<number> {
  return (await fetch(`${KC}/realms/${realm}/sms/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) })).status;
}

export async function readOutbox(realm: string, phone: string, auth = true): Promise<string> {
  const r = await fetch(`${KC}/realms/${realm}/sms/outbox?phone=${encodeURIComponent(phone)}`, auth ? { headers: { authorization: `Bearer ${await adminToken()}` } } : {});
  if (!r.ok) throw new Error(`outbox ${r.status}`);
  return ((await r.json()) as { code: string }).code;
}

export type TokenResult = { ok: true; accessToken: string; claims: Record<string, unknown> } | { ok: false; status: number; error: string; description?: string };

export async function tokenBySms(realm: string, phone: string, code: string, deviceId = 'device-1'): Promise<TokenResult> {
  const r = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'app', phone, code, device_id: deviceId }),
  });
  const j = (await r.json()) as Record<string, string>;
  if (!r.ok) return { ok: false, status: r.status, error: j.error ?? 'unknown', ...(j.error_description ? { description: j.error_description } : {}) };
  const claims = JSON.parse(Buffer.from(j.access_token!.split('.')[1]!, 'base64url').toString());
  return { ok: true, accessToken: j.access_token!, claims };
}

/** Full SMS login: request a code, read it from the stand outbox, exchange it for a token. */
export async function smsLogin(realm: string, phone: string, deviceId = 'device-1'): Promise<TokenResult> {
  const s = await requestCode(realm, phone);
  if (s !== 204) return { ok: false, status: s, error: 'code_request_failed' };
  return tokenBySms(realm, phone, await readOutbox(realm, phone), deviceId);
}

export async function usersByPhone(realm: string, phone: string): Promise<string[]> {
  const r = await admin(`${realm}/users?q=${encodeURIComponent(`phone:${phone}`)}&max=100`);
  if (!r.ok) throw new Error(`users by phone ${r.status}`);
  return ((await r.json()) as { id: string }[]).map((u) => u.id);
}

export async function deleteUser(realm: string, id: string): Promise<void> {
  const r = await admin(`${realm}/users/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error(`delete user ${r.status}`);
}
