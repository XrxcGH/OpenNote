// ADR status words (first word) agree with the index rows, and the changelog's Accepted list agrees with both.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const adrDir = join(root, 'docs', 'adr');
const index = readFileSync(join(adrDir, 'README.md'), 'utf8');

function fileStatus(file: string): string {
  const m = /^- Status:\s*(.+)$/m.exec(readFileSync(join(adrDir, file), 'utf8'));
  return m ? (m[1].trim().split(/[\s,.;(:-]/)[0] ?? '') : '';
}
function indexStatus(num: string): string {
  const row = index.split('\n').find((l) => l.startsWith(`| [${num}]`));
  return row ? ((row.split('|')[3] ?? '').trim().split(/[\s,.;(:-]/)[0] ?? '') : '';
}

describe('ADR status', () => {
  const files = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));
  it('each file status matches its index row', () => {
    const bad = files.filter((f) => fileStatus(f) !== indexStatus(f.slice(0, 4))).map((f) => f.slice(0, 4));
    expect(bad).toEqual([]);
  });
  it('the changelog Accepted list is Accepted in the index', () => {
    const log = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    const line = /Records ([^.]*?) are Accepted\./.exec(log)?.[1] ?? '';
    const nums = new Set<string>();
    for (const part of line.replace(/ and /g, ', ').split(',')) {
      const r = /(\d{4})(?: to (\d{4}))?/.exec(part);
      if (!r) continue;
      for (let n = +r[1]; n <= +(r[2] ?? r[1]); n++) nums.add(String(n).padStart(4, '0'));
    }
    expect(nums.size).toBeGreaterThan(10);
    const bad = [...nums].filter((n) => files.some((f) => f.startsWith(n)) && indexStatus(n) !== 'Accepted');
    expect(bad).toEqual([]);
  });
});
