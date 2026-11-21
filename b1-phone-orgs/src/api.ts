/**
 * Application API in two variants over one database.
 * naive: trusts the company claim of whichever Keycloak user signed in; consent = one flag per phone.
 * fixed: the token says who the person is; every request checks membership, revocation and consent versions.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { pool } from './db.ts';
import { KC, logoutUser, setEnabled } from './kc.ts';

export type Mode = 'naive' | 'fixed';
export interface Api {
  url: string;
  close(): Promise<void>;
}
const ADMIN_KEY = 'stand-admin';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function latestVersion(doc: string): Promise<{ id: number; version: number; scope: string } | undefined> {
  const { rows } = await pool.query(
    `SELECT v.id, v.version, d.scope FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.document_id = $1 ORDER BY v.version DESC LIMIT 1`, [doc]);
  return rows[0];
}

export async function startApi(mode: Mode, port: number): Promise<Api> {
  const jwks = createRemoteJWKSet(new URL(`${KC}/realms/${mode}/protocol/openid-connect/certs`));
  const issuer = `${KC}/realms/${mode}`;

  async function auth(req: IncomingMessage): Promise<JWTPayload | undefined> {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return undefined;
    try {
      return (await jwtVerify(h.slice(7), jwks, { issuer })).payload;
    } catch {
      return undefined;
    }
  }

  /** fixed: active membership and a token issued after the last revocation for this person in this company. */
  async function canAct(t: JWTPayload, org: string): Promise<boolean> {
    if (mode === 'naive') return t.org === org;
    const { rows } = await pool.query(
      `SELECT m.status, r.at FROM memberships m LEFT JOIN revoked_before r ON r.person_id = m.person_id AND r.org_id = m.org_id WHERE m.person_id = $1 AND m.org_id = $2`,
      [t.sub, org]);
    if (!rows[0] || rows[0].status !== 'active') return false;
    return !rows[0].at || (t.iat ?? 0) * 1000 > new Date(rows[0].at).getTime();
  }

  async function hasConsent(t: JWTPayload, org: string, doc: string): Promise<{ ok: boolean; version?: number }> {
    if (mode === 'naive') {
      const { rows } = await pool.query('SELECT accepted FROM naive_consents WHERE phone = $1', [t.phone]);
      return { ok: !!rows[0]?.accepted };
    }
    const v = await latestVersion(doc);
    if (!v) return { ok: false };
    const { rowCount } = await pool.query(
      `SELECT 1 FROM acceptances WHERE person_id = $1 AND version_id = $2 AND COALESCE(org_id, '') = $3`, [t.sub, v.id, v.scope === 'org' ? org : '']);
    return { ok: !!rowCount, version: v.version };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    let m: RegExpMatchArray | null;

    if (p.startsWith('/admin/')) {
      if (req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 401, { error: 'admin key required' });
      if ((m = p.match(/^\/admin\/orgs\/([A-Z])\/members\/([\w-]+)\/fire$/)) && req.method === 'POST') {
        const [, org, person] = m as unknown as [string, string, string];
        if (mode === 'naive') {
          // Naive firing: the company's Keycloak user is disabled. Tokens already issued stay valid.
          await setEnabled('naive', person, false);
        } else {
          await pool.query(`UPDATE memberships SET status = 'fired', ended_at = now() WHERE person_id = $1 AND org_id = $2`, [person, org]);
          await pool.query(`INSERT INTO revoked_before (person_id, org_id, at) VALUES ($1, $2, now()) ON CONFLICT (person_id, org_id) DO UPDATE SET at = now()`, [person, org]);
          await logoutUser('fixed', person);
        }
        return send(res, 204, {});
      }
      return send(res, 404, { error: 'not found' });
    }

    const t = await auth(req);
    if (!t) return send(res, 401, { error: 'invalid or missing token' });

    if ((m = p.match(/^\/orgs\/([A-Z])\/data$/)) && req.method === 'GET') {
      const org = m[1]!;
      return (await canAct(t, org)) ? send(res, 200, { org, data: `данные компании ${org}` }) : send(res, 403, { error: 'no access to this company' });
    }
    if ((m = p.match(/^\/orgs\/([A-Z])\/payments$/)) && req.method === 'GET') {
      const org = m[1]!;
      if (!(await canAct(t, org))) return send(res, 403, { error: 'no access to this company' });
      const c = await hasConsent(t, org, 'payments-terms');
      return c.ok ? send(res, 200, { org, payments: [] }) : send(res, 428, { error: 'consent required', document: 'payments-terms', version: c.version });
    }
    if ((m = p.match(/^\/orgs\/([A-Z])\/consents\/([\w-]+)\/accept$/)) && req.method === 'POST') {
      const [, org, doc] = m as unknown as [string, string, string];
      if (!(await canAct(t, org))) return send(res, 403, { error: 'no access to this company' });
      if (mode === 'naive') {
        await pool.query(`INSERT INTO naive_consents (phone, accepted) VALUES ($1, true) ON CONFLICT (phone) DO UPDATE SET accepted = true, accepted_at = now()`, [t.phone]);
        return send(res, 204, {});
      }
      const v = await latestVersion(doc);
      if (!v) return send(res, 404, { error: 'unknown document' });
      await pool.query(`INSERT INTO acceptances (person_id, version_id, org_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [t.sub, v.id, v.scope === 'org' ? org : null]);
      return send(res, 204, {});
    }
    return send(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: String(e) }));
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const { port: actual } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${actual}`, close: () => new Promise((r) => server.close(() => r())) };
}

export const ADMIN_HEADERS = { 'x-admin-key': ADMIN_KEY };
