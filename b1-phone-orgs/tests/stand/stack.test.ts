import pg from 'pg';
import { describe, expect, it } from 'vitest';

describe('stack', () => {
  it('both realms publish OIDC discovery', async () => {
    for (const r of ['naive', 'fixed']) expect((await fetch(`http://localhost:18080/realms/${r}/.well-known/openid-configuration`)).status, r).toBe(200);
  });
  it('app schema has the expected tables', async () => {
    const c = new pg.Client({ connectionString: 'postgres://app:app-stand-only@localhost:15432/app' });
    await c.connect();
    const { rows } = await c.query("select table_name from information_schema.tables where table_schema='public' order by 1");
    await c.end();
    expect(rows.map((r) => r.table_name)).toEqual(['acceptances', 'document_versions', 'documents', 'memberships', 'naive_consents', 'organizations', 'persons', 'revoked_before']);
  });
});
