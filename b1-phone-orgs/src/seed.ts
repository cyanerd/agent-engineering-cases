import { pool, ensureReference } from './db.ts';
import { createUser, deleteUser } from './kc.ts';

export interface PersonSpec {
  name: string;
  phone: string;
  orgs: string[];
  /** Device the person usually signs in from. */
  device: string;
  /** How long ago the phone was verified. */
  verifiedDaysAgo?: number;
}
export interface Seeded {
  /** fixed: the single person id; naive: one Keycloak user per company. */
  personId?: string;
  usersByOrg: Record<string, string>;
}

/**
 * naive: what a first implementation does - a separate Keycloak user per company, all with the same phone.
 * fixed: one person, phone unique and verified, access through memberships in the app database.
 */
export async function seedPerson(mode: 'naive' | 'fixed', p: PersonSpec): Promise<Seeded> {
  await ensureReference();
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (mode === 'naive') {
    const usersByOrg: Record<string, string> = {};
    for (const org of p.orgs) usersByOrg[org] = await createUser('naive', `${org.toLowerCase()}-${suffix}`, { phone: [p.phone], org: [org] });
    return { usersByOrg };
  }
  const taken = await pool.query('SELECT 1 FROM persons WHERE phone = $1', [p.phone]);
  if (taken.rowCount) throw new Error(`409 phone ${p.phone} already belongs to a person`);
  const verifiedAt = new Date(Date.now() - (p.verifiedDaysAgo ?? 0) * 86_400_000).toISOString();
  const id = await createUser('fixed', `person-${suffix}`, { phone: [p.phone], phoneVerified: ['true'], phoneVerifiedAt: [verifiedAt], knownDevices: [p.device] });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO persons (id, display_name, phone, phone_verified_at) VALUES ($1, $2, $3, $4)', [id, p.name, p.phone, verifiedAt]);
    for (const org of p.orgs) await client.query(`INSERT INTO memberships (person_id, org_id, role, status) VALUES ($1, $2, 'employee', 'active')`, [id, org]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    // Compensation: the Keycloak user must not outlive a failed person record, or the real owner gets ambiguous_phone.
    await deleteUser('fixed', id);
    if ((e as { code?: string }).code === '23505') throw new Error(`409 phone ${p.phone} already belongs to a person`);
    throw e;
  } finally {
    client.release();
  }
  return { personId: id, usersByOrg: Object.fromEntries(p.orgs.map((o) => [o, id])) };
}
