export interface Profile {
  id: string;
  label: string;
  /** L1: hidden HTML stripped, unicode normalised, email wrapped as untrusted data. */
  input: 'plain' | 'spotlight';
  /** L1: system prompt states that email content is data and who may get customer data. */
  promptHardening: boolean;
  /** L2: untrusted reader without dangerous tools -> structured intents -> code executor. */
  split: boolean;
  /** L3: deterministic policy on every side effect. */
  policy: boolean;
  /** L4: bulk personal data waits for a human. */
  approval: boolean;
  /** L5: audit log, alerts, rate limit. */
  audit: boolean;
}

const off = { input: 'plain', promptHardening: false, split: false, policy: false, approval: false, audit: false } as const;

export const PROFILES: Profile[] = [
  { id: 'L0-baseline', label: 'Без защиты: все инструменты, обычный продуктовый промпт', ...off },
  { id: 'L1-prompt', label: 'L1: очистка входа, spotlighting, жёсткий промпт', ...off, input: 'spotlight', promptHardening: true },
  { id: 'L3-policy', label: 'L3: только политика вне модели', ...off, policy: true },
  { id: 'L1+L3', label: 'L1 + L3', ...off, input: 'spotlight', promptHardening: true, policy: true },
  { id: 'L2-split', label: 'L2: читатель без прав + исполнитель-код', ...off, input: 'spotlight', split: true },
  { id: 'full', label: 'Все слои: L1 + L2 + L3 + L4 + L5', input: 'spotlight', promptHardening: true, split: true, policy: true, approval: true, audit: true },
];

export const POLICY = {
  allowExportTo: ['analytics@acme.example', 'crm-import@acme.example'],
  approvalThreshold: 10,
  exportsPerHour: 5,
};
