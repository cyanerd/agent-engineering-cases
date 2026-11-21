import type { GateDecision } from '../tools.ts';
import type { SideEffect } from '../types.ts';

export interface AuditEvent {
  effect: Exclude<SideEffect, { kind: 'approval_requested' }>;
  decision: GateDecision;
}
export interface Alert {
  kind: 'denied' | 'approval';
  to: string;
  reason: string;
}

/** Records every gated action; denials and approval requests become alerts for a human. */
export function createAudit() {
  const log: AuditEvent[] = [];
  return {
    record(e: AuditEvent) {
      log.push(e);
    },
    events: () => [...log],
    alerts: (): Alert[] =>
      log.flatMap(({ effect, decision }) =>
        decision.allow === true ? [] : [{ kind: decision.allow === 'approval' ? 'approval' : 'denied', to: effect.to, reason: decision.reason } as Alert],
      ),
  };
}
export type Audit = ReturnType<typeof createAudit>;
