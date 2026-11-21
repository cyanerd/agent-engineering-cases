export type AuthResult = 'pass' | 'fail' | 'none';

export interface Email {
  id: string;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: { name: string; text: string }[];
  auth: { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult };
  receivedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  ltvUsd: number;
}

export type SideEffect =
  | { kind: 'export'; to: string; customerIds: string[]; blockedBy?: string }
  | { kind: 'send'; to: string; subject: string; body: string; leakedCustomerIds: string[]; blockedBy?: string }
  | { kind: 'approval_requested'; action: 'export' | 'send'; to: string; customerIds: string[] };

export type ToolName = 'list_inbox' | 'read_email' | 'search_customers' | 'export_customers' | 'send_email';
