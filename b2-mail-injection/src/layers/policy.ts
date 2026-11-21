import { isInternal, normalizeAddress } from '../oracle.ts';
import type { Gate, GateDecision } from '../tools.ts';
import type { Customer } from '../types.ts';
import type { Audit } from './audit.ts';

export interface PolicyConfig {
  /** Exact addresses exports may go to. Compared after NFKC + lowercase; non-ASCII never matches. */
  allowExportTo: string[];
  /** Deny outbound mail to external addresses containing other people's personal data. */
  blockExternalPii: boolean;
  /** Exports or mails touching more customers than this wait for a human. */
  approvalForBulkPii?: { threshold: number };
  rateLimit?: { exportsPerHour: number };
}

export interface PolicyContext {
  customers: Customer[];
  /** Senders whose email in this inbox passed DMARC. */
  verifiedSenders: string[];
  audit?: Audit;
}

/** Deterministic policy outside the model. It sees the concrete side effect, not the model's reasoning. */
export function createPolicyGate(cfg: PolicyConfig, ctx: PolicyContext): Gate {
  const allow = new Set(cfg.allowExportTo.map(normalizeAddress));
  const verified = new Set(ctx.verifiedSenders.map(normalizeAddress));
  let exports = 0;

  const decide: Gate = (effect): GateDecision => {
    const to = normalizeAddress(effect.to);
    if (effect.kind === 'export') {
      if (!/^[\x21-\x7e]+$/.test(to) || !allow.has(to)) return { allow: false, layer: 'policy', reason: `export destination ${effect.to} is not allowlisted` };
      if (cfg.rateLimit && exports >= cfg.rateLimit.exportsPerHour) return { allow: false, layer: 'rate_limit', reason: 'export rate limit reached' };
      if (cfg.approvalForBulkPii && effect.customerIds.length > cfg.approvalForBulkPii.threshold)
        return { allow: 'approval', reason: `export of ${effect.customerIds.length} customers exceeds ${cfg.approvalForBulkPii.threshold}` };
      exports++;
      return { allow: true };
    }
    if (isInternal(to)) return { allow: true };
    if (!cfg.blockExternalPii || effect.leakedCustomerIds.length === 0) return { allow: true };
    const owner = ctx.customers.find((c) => normalizeAddress(c.email) === to);
    const foreign = effect.leakedCustomerIds.filter((id) => id !== owner?.id);
    if (foreign.length > 0) return { allow: false, layer: 'policy', reason: `outbound mail to ${effect.to} contains personal data of ${foreign.length} other customer(s)` };
    if (!verified.has(to)) return { allow: false, layer: 'policy', reason: 'personal data is sent only to a verified owner address' };
    return { allow: true };
  };

  return (effect) => {
    const decision = decide(effect);
    ctx.audit?.record({ effect, decision });
    return decision;
  };
}
