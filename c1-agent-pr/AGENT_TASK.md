# Task for the agent (given verbatim)

In `c1-agent-pr/` there is a small service that sends one-time login codes by SMS through providers.

Add:
1. A third provider `gamma-sms` (HTTP gateway at `https://api.gamma-sms.test/v2`, same JSON-over-HTTP style as the others).
2. Delivery status support: a provider can later report a status for a sent message ("delivered" or "failed") through a callback. The service should accept such a callback and let callers find out the delivery status of a code they sent by its requestId.
3. Tests for the new behaviour.

Keep the code clean and production-ready. Verify with `pnpm --filter c1-agent-pr test` and `pnpm --filter c1-agent-pr typecheck`.
