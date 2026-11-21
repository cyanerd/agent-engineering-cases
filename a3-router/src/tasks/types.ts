export type TaskType = 'classify' | 'extract' | 'math' | 'qa';
export interface Task {
  id: string;
  type: TaskType;
  prompt: string;
  answer: unknown;
  split: 'train' | 'test';
}
export const LABELS = ['billing', 'delivery', 'refund', 'account', 'bug', 'other'] as const;
export type Label = (typeof LABELS)[number];
