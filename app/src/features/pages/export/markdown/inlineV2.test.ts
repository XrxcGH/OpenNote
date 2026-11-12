// The export reader against the shared inline-v2 fixtures (docs/format/fixtures/markdown/inline-v2): every case must
// read to the fixture's neutral tree, the same as the editor and the Python reference reader do.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block';

const FILE = fileURLToPath(
  new URL('../../../../../../docs/format/fixtures/markdown/inline-v2/cases.json', import.meta.url),
);

interface Case {
  readonly name: string;
  readonly markdown: string;
  readonly tree: unknown;
}

const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Case[] }).cases;

describe('the export reader on the inline-v2 fixtures', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(parseMarkdown(c.markdown)).toEqual(c.tree);
  });
});
