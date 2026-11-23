// Guards the table help page and README against drifting from the app.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('table help docs', () => {
  it('names no internal release codes', () => {
    expect(read('docs/help/tables-and-charts.md')).not.toMatch(/\bB\d+\.\d+\b/);
  });
  it('README lists data validation', () => {
    expect(read('README.md')).toMatch(/data validation/i);
  });
  it('help gives the spill error token and its tooltip words', () => {
    const t = read('docs/help/tables-and-charts.md');
    expect(t).toContain('#SPILL!');
    expect(t).toContain('No room to spill');
  });
});
