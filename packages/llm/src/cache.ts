import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatRequest, ChatResult } from './types.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(req: ChatRequest): string {
  return createHash('sha256').update(canonical(req)).digest('hex');
}

const pathFor = (dir: string, key: string) => join(dir, key.slice(0, 2), `${key}.json`);

export async function readCache(dir: string, key: string): Promise<ChatResult | undefined> {
  try {
    const stored = JSON.parse(await readFile(pathFor(dir, key), 'utf8')) as ChatResult;
    return { ...stored, cached: true };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** Atomic: write a unique temp file, then rename over the target. */
export async function writeCache(dir: string, key: string, result: ChatResult): Promise<void> {
  const target = pathFor(dir, key);
  await mkdir(join(dir, key.slice(0, 2)), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...result, cached: false }, null, 2));
  await rename(tmp, target);
}
