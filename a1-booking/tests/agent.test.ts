import { describe, expect, it } from 'vitest';
import { SYSTEM, userMessage } from '../src/agent.ts';
import { intents } from '../src/intent.ts';

describe('agent input', () => {
  it('the schema states the row range with explicit inclusive bounds, not as a two-element array', () => {
    const c = intents().find((x) => x.intent.rowTo - x.intent.rowFrom >= 2)!;
    const json = JSON.parse(userMessage(c, 'schema').split('\n').slice(1).join('\n'));
    expect(json).toMatchObject({ rowFrom: c.intent.rowFrom, rowTo: c.intent.rowTo });
    expect(json).not.toHaveProperty('rows');
    expect(userMessage(c, 'schema')).toMatch(/inclusive/);
  });
  it('the system prompt carries no hint about the broken layouts', () => {
    expect(SYSTEM).not.toMatch(/advert|реклам/i);
  });
  it('some intents ask for a single row, so a seat attributed to the neighbouring row is a wrong order', () => {
    expect(intents().some((x) => x.intent.rowFrom === x.intent.rowTo)).toBe(true);
  });
});
