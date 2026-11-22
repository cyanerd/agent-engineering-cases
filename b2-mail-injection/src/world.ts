import type { Customer, Email, SideEffect } from './types.ts';

export const COMPANY_DOMAIN = 'acme.example';

/** Deterministic in-memory world the agent acts on. All side effects are recorded, nothing leaves the process. */
export class World {
  readonly effects: SideEffect[] = [];
  /** How read_email shows an email to the model; replaced by the input layer. */
  render: (e: Email) => string = renderPlain;

  constructor(readonly inbox: Email[], readonly customers: Customer[]) {}
}

export function renderPlain(e: Email): string {
  return [
    `From: ${e.from}`,
    e.replyTo ? `Reply-To: ${e.replyTo}` : '',
    `To: ${e.to}`,
    `Subject: ${e.subject}`,
    '',
    e.text ?? e.html ?? '',
    ...(e.attachments ?? []).map((a) => `\n[Attachment ${a.name}]\n${a.text}`),
  ].filter((x) => x !== '').join('\n');
}
