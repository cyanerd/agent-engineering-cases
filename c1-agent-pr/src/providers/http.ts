import { ProviderError, type SmsMessage, type SmsProvider } from '../types.ts';

/** Generic JSON-over-HTTP gateway: POST {baseUrl}/messages with an Idempotency-Key header. */
export class HttpSmsProvider implements SmsProvider {
  constructor(readonly name: string, private readonly baseUrl: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(msg: SmsMessage, signal: AbortSignal): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}`, 'idempotency-key': msg.idempotencyKey },
        body: JSON.stringify({ to: msg.to, text: msg.text }),
      });
    } catch (e) {
      throw new ProviderError(`${this.name}: network error ${(e as Error).message}`, true);
    }
    if (!res.ok) throw new ProviderError(`${this.name}: HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? '' };
  }
}
