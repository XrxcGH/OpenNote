// Approved results for the PDF tests, kept as JSON beside the tests, one folder for each platform, because text layout
// differs a little between engines and platforms. A missing file for a platform means no approval yet, and the test checks
// the invariants only. Write the files again with OPENNOTE_BLESS=1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./golden/', import.meta.url));

export interface GoldenPage {
  readonly width: number;
  readonly height: number;
  /** The first and last 48 characters of the page's text, with white space as single spaces. */
  readonly start: string;
  readonly end: string;
  readonly words: number;
}

export interface Golden {
  readonly pages: readonly GoldenPage[];
  readonly outline: readonly string[];
  readonly structure: Readonly<Record<string, number>>;
}

export function summarize(info: {
  pages: readonly { width: number; height: number; text: string }[];
  outline: readonly string[];
  structure: Readonly<Record<string, number>>;
}): Golden {
  return {
    pages: info.pages.map((p) => {
      const text = p.text.replace(/\s+/g, ' ').trim();
      return {
        width: p.width,
        height: p.height,
        start: text.slice(0, 48),
        end: text.slice(-48),
        words: text.split(' ').length,
      };
    }),
    outline: info.outline,
    structure: info.structure,
  };
}

/** Compares with the approved file. Returns the file's path and whether one was found. */
export function readGolden(name: string): { path: string; golden: Golden | null } {
  const path = join(ROOT, process.platform, `${name}.json`);
  return { path, golden: existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Golden) : null };
}

export function writeGolden(path: string, golden: Golden): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(golden, null, 2)}\n`);
}

export const blessing = (): boolean => process.env.OPENNOTE_BLESS === '1';
