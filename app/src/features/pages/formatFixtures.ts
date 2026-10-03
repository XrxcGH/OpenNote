// The shared format fixtures (docs/format/fixtures), for the tests of this feature. Production code never imports it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../../../../docs/format/fixtures/', import.meta.url));

export function fixtureText(...path: string[]): string {
  return readFileSync(join(FIXTURES, ...path), 'utf8');
}

export function fixtureJson<T = unknown>(...path: string[]): T {
  return JSON.parse(fixtureText(...path)) as T;
}
