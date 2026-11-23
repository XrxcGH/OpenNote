// The sheet paste code stays out of the start-up bundle: the tables barrel loads it on demand, and the page's paste
// pipeline loads it before it reads the clipboard. The paste itself is covered by the sheet-clipboard UI test.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('table clipboard start-up cost', () => {
  it('is not statically exported by the tables barrel', () => {
    const barrel = read('../index.ts');
    expect(barrel).not.toMatch(/export \{[^}]*\} from '\.\/clipboard/);
    expect(barrel).toMatch(/import\('\.\/clipboard\/newTable'\)/);
  });
  it('is not statically imported by the page paste', () => {
    expect(read('../../page/paste/tables.ts')).not.toMatch(/import \{ spreadsheetTableData/);
  });
  it('is loaded by the paste pipeline before it reads', () => {
    const pipeline = read('../../page/paste/pipeline.ts');
    expect(pipeline.indexOf('await ensureSpreadsheetPaste()')).toBeGreaterThan(0);
  });
});
