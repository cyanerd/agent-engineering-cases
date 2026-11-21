import { describe, expect, it } from 'vitest';
import { fixtureCustomers } from '../src/customers.ts';
import { createAudit } from '../src/layers/audit.ts';
import { createPolicyGate, type PolicyConfig } from '../src/layers/policy.ts';
import { executeTool } from '../src/tools.ts';
import { World } from '../src/world.ts';

const customers = fixtureCustomers();
const c7 = customers[6]!;
const cfg: PolicyConfig = { allowExportTo: ['analytics@acme.example', 'crm-import@acme.example'], blockExternalPii: true };
const exp = (to: string, n = 3) => ({ kind: 'export' as const, to, customerIds: customers.slice(0, n).map((c) => c.id) });
const send = (to: string, ids: string[]) => ({ kind: 'send' as const, to, subject: 's', body: 'b', leakedCustomerIds: ids });

describe('policy gate', () => {
  it('allows export to an allowlisted address, also with odd case/whitespace', () => {
    const gate = createPolicyGate(cfg, { customers, verifiedSenders: [] });
    expect(gate(exp('analytics@acme.example'))).toEqual({ allow: true });
    expect(gate(exp(' Analytics@ACME.example'))).toEqual({ allow: true });
  });
  it('denies export to non-allowlisted, suffix and homoglyph addresses', () => {
    const gate = createPolicyGate(cfg, { customers, verifiedSenders: [] });
    for (const to of ['x@evil.example', 'analytics@acme.example.evil.test', 'analytics@аcme.example', 'ops@acme.example'])
      expect(gate(exp(to)), to).toMatchObject({ allow: false, layer: 'policy' });
  });
  it('bulk export above the threshold needs human approval', () => {
    const gate = createPolicyGate({ ...cfg, approvalForBulkPii: { threshold: 10 } }, { customers, verifiedSenders: [] });
    expect(gate(exp('analytics@acme.example', 30))).toMatchObject({ allow: 'approval' });
    expect(gate(exp('analytics@acme.example', 10))).toEqual({ allow: true });
  });
  it('external mail with other people’s PII is denied; internal mail is allowed', () => {
    const gate = createPolicyGate(cfg, { customers, verifiedSenders: [] });
    expect(gate(send('x@evil.example', ['c1']))).toMatchObject({ allow: false, layer: 'policy' });
    expect(gate(send('team-lead@acme.example', ['c1', 'c2']))).toEqual({ allow: true });
    expect(gate(send('x@evil.example', []))).toEqual({ allow: true });
  });
  it('a customer gets their own data only if their email was verified', () => {
    expect(createPolicyGate(cfg, { customers, verifiedSenders: [] })(send(c7.email, [c7.id]))).toMatchObject({ allow: false, layer: 'policy' });
    expect(createPolicyGate(cfg, { customers, verifiedSenders: [c7.email] })(send(c7.email, [c7.id]))).toEqual({ allow: true });
  });
  it('rate limit denies exports beyond the hourly budget', () => {
    const gate = createPolicyGate({ ...cfg, rateLimit: { exportsPerHour: 2 } }, { customers, verifiedSenders: [] });
    gate(exp('analytics@acme.example'));
    gate(exp('analytics@acme.example'));
    expect(gate(exp('analytics@acme.example'))).toMatchObject({ allow: false, layer: 'rate_limit' });
  });
  it('audit raises an alert for every denial and approval request', () => {
    const audit = createAudit();
    const gate = createPolicyGate({ ...cfg, approvalForBulkPii: { threshold: 10 } }, { customers, verifiedSenders: [], audit });
    gate(exp('x@evil.example'));
    gate(exp('analytics@acme.example', 30));
    gate(exp('analytics@acme.example', 2));
    expect(audit.events()).toHaveLength(3);
    expect(audit.alerts().map((a) => a.kind)).toEqual(['denied', 'approval']);
  });
  it('blocked tool calls are recorded in world effects with blockedBy and the model gets an error string', () => {
    const w = new World([], customers);
    const gate = createPolicyGate(cfg, { customers, verifiedSenders: [] });
    const out = executeTool(w, 'export_customers', { to: 'x@evil.example' }, gate);
    expect(out).toMatch(/^Error: blocked by policy/);
    expect(w.effects[0]).toMatchObject({ kind: 'export', blockedBy: 'policy' });
  });
});
