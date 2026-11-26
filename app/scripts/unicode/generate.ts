// Generates app/src/features/page/symbols/symbolData.json from the pinned name list (ucd-subset.txt), for the symbol
// dialog (ADR 0088). The JSON holds one entry per code point: its number and its Unicode name. Blocks and categories
// are listed here, so the file stays small. A test runs buildSymbolData and compares it with the committed JSON.
// Run with: node app/scripts/unicode/generate.ts     Check it is current: node app/scripts/unicode/generate.ts --check

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type CategoryId = 'punctuation' | 'letters' | 'currency' | 'math' | 'arrows' | 'symbols' | 'emoji';

export interface BlockDef {
  id: string;
  name: string;
  category: CategoryId;
  lo: number;
  hi: number;
}

/** The blocks of the subset. extract-names.py lists the same ranges. */
export const BLOCKS: readonly BlockDef[] = [
  { id: 'basic-latin', name: 'Basic Latin', category: 'punctuation', lo: 0x20, hi: 0x7f },
  { id: 'latin-1', name: 'Latin-1 Supplement', category: 'letters', lo: 0xa0, hi: 0xff },
  { id: 'latin-a', name: 'Latin Extended-A', category: 'letters', lo: 0x100, hi: 0x17f },
  { id: 'latin-b', name: 'Latin Extended-B', category: 'letters', lo: 0x180, hi: 0x24f },
  { id: 'greek', name: 'Greek and Coptic', category: 'letters', lo: 0x370, hi: 0x3ff },
  { id: 'cyrillic', name: 'Cyrillic', category: 'letters', lo: 0x400, hi: 0x4ff },
  { id: 'punctuation', name: 'General Punctuation', category: 'punctuation', lo: 0x2000, hi: 0x206f },
  { id: 'scripts', name: 'Superscripts and Subscripts', category: 'math', lo: 0x2070, hi: 0x209f },
  { id: 'currency', name: 'Currency Symbols', category: 'currency', lo: 0x20a0, hi: 0x20cf },
  { id: 'letterlike', name: 'Letterlike Symbols', category: 'symbols', lo: 0x2100, hi: 0x214f },
  { id: 'numbers', name: 'Number Forms', category: 'math', lo: 0x2150, hi: 0x218f },
  { id: 'arrows', name: 'Arrows', category: 'arrows', lo: 0x2190, hi: 0x21ff },
  { id: 'operators', name: 'Mathematical Operators', category: 'math', lo: 0x2200, hi: 0x22ff },
  { id: 'technical', name: 'Miscellaneous Technical', category: 'symbols', lo: 0x2300, hi: 0x23ff },
  { id: 'box', name: 'Box Drawing', category: 'symbols', lo: 0x2500, hi: 0x257f },
  { id: 'blocks', name: 'Block Elements', category: 'symbols', lo: 0x2580, hi: 0x259f },
  { id: 'shapes', name: 'Geometric Shapes', category: 'symbols', lo: 0x25a0, hi: 0x25ff },
  { id: 'misc', name: 'Miscellaneous Symbols', category: 'symbols', lo: 0x2600, hi: 0x26ff },
  { id: 'dingbats', name: 'Dingbats', category: 'symbols', lo: 0x2700, hi: 0x27bf },
  { id: 'math-a', name: 'Miscellaneous Mathematical Symbols-A', category: 'math', lo: 0x27c0, hi: 0x27ef },
  { id: 'arrows-a', name: 'Supplemental Arrows-A', category: 'arrows', lo: 0x27f0, hi: 0x27ff },
  { id: 'arrows-b', name: 'Supplemental Arrows-B', category: 'arrows', lo: 0x2900, hi: 0x297f },
  { id: 'arrows-misc', name: 'Miscellaneous Symbols and Arrows', category: 'arrows', lo: 0x2b00, hi: 0x2bff },
  { id: 'pictographs', name: 'Miscellaneous Symbols and Pictographs', category: 'emoji', lo: 0x1f300, hi: 0x1f5ff },
  { id: 'emoticons', name: 'Emoticons', category: 'emoji', lo: 0x1f600, hi: 0x1f64f },
  { id: 'transport', name: 'Transport and Map Symbols', category: 'emoji', lo: 0x1f680, hi: 0x1f6ff },
  { id: 'supplemental', name: 'Supplemental Symbols and Pictographs', category: 'emoji', lo: 0x1f900, hi: 0x1f9ff },
];

export interface SymbolBlock {
  id: string;
  name: string;
  category: CategoryId;
  /** Code point and Unicode name, in code point order. */
  chars: [number, string][];
}

export interface SymbolData {
  unicode: string;
  blocks: SymbolBlock[];
}

/** Builds the data from the text of ucd-subset.txt (a comment line, then "HEX;NAME" lines). */
export function buildSymbolData(source: string): SymbolData {
  const version = /Database ([\d.]+)/.exec(source)?.[1] ?? '';
  const blocks: SymbolBlock[] = BLOCKS.map((b) => ({ id: b.id, name: b.name, category: b.category, chars: [] }));
  for (const line of source.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [hex, name] = line.trim().split(';');
    const cp = parseInt(hex ?? '', 16);
    const at = BLOCKS.findIndex((b) => cp >= b.lo && cp <= b.hi);
    // A plain space needs no symbol, and its cell would be blank.
    if (at < 0 || !name || cp === 0x20) continue;
    blocks[at]?.chars.push([cp, name]);
  }
  return { unicode: version, blocks: blocks.filter((b) => b.chars.length > 0) };
}

const DIR = import.meta.dirname;
const OUT = join(DIR, '..', '..', 'src', 'features', 'page', 'symbols', 'symbolData.json');

export function renderSymbolData(): string {
  return JSON.stringify(buildSymbolData(readFileSync(join(DIR, 'ucd-subset.txt'), 'utf8'))) + '\n';
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const text = renderSymbolData();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) {
      console.error('symbolData.json is out of date. Run: node app/scripts/unicode/generate.ts');
      process.exit(1);
    }
  } else writeFileSync(OUT, text);
}
