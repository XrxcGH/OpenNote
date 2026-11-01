// A command id that code runs by name must be one that some defineCommand registers. A misspelled or retired id is
// swallowed by the callers' catch, so the feature silently never runs (the phone dialog once ran object.scanCleanup).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Registered from id tables (a prefix plus a row id) that a text scan cannot see.
const FROM_TABLES = new Set(['tools.upcoming', 'tools.timers', 'object.delete', 'notes.newPage']);

describe('command ids', () => {
  const files = sources(src).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const registered = new Set(files.flatMap((f) => [...f.text.matchAll(/\bid: '([a-zA-Z0-9.]+)'/g)].map((m) => m[1]!)));

  it('are all registered when run by name', () => {
    const missing = files.flatMap((f) =>
      [...f.text.matchAll(/executeCommand\(\s*'([a-zA-Z0-9.]+)'/g)]
        .map((m) => m[1]!)
        .filter((id) => !registered.has(id) && !FROM_TABLES.has(id))
        .map((id) => `${f.path.slice(src.length + 1)}: ${id}`),
    );
    expect(missing).toEqual([]);
  });
});
