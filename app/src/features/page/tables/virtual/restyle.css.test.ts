// A long table's window move restyles only the rows that come (docs/perf/tables.md, "Scroll frames"). Two rules
// once made it restyle every drawn row: the padding's custom properties were inherited, and the first block rule
// of the text styles put `:first-child` before a sibling combinator. The perf spec counts the restyled elements in
// a browser; these checks keep the two rules from coming back where the spec does not run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const virtual = readFileSync(join(import.meta.dirname, 'virtual.module.css'), 'utf8');
const blocks = readFileSync(join(import.meta.dirname, '..', '..', 'blocks', 'blocks.module.css'), 'utf8');

/** The selectors of every rule, comments taken out. */
function selectors(source: string): string[] {
  const plain = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{};]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
}

describe('a window move restyles only the rows that come', () => {
  it.each(['--opennote-vrows-above', '--opennote-vrows-below'])('%s is registered as not inherited', (name) => {
    const at = virtual.indexOf(`@property ${name}`);
    expect(at).toBeGreaterThan(-1);
    expect(virtual.slice(at, virtual.indexOf('}', at))).toMatch(/inherits:\s*false/);
  });

  it('the editor and the table wrapper ask for the padding heights, so they still reach the padding', () => {
    expect(virtual).toMatch(/--opennote-vrows-above:\s*inherit/);
    expect(virtual).toMatch(/--opennote-vrows-below:\s*inherit/);
  });

  it('no text rule puts a structural pseudo-class before a sibling combinator', () => {
    const risky = selectors(blocks).filter((s) => /:(first|last|nth|only)[\w-]*(\([^)]*\))?\s*[+~]/.test(s));
    expect(risky).toEqual([]);
  });

  it('the first block rule turns table rows away', () => {
    const first = selectors(blocks).filter((s) => s.includes('.ProseMirror) >') && /first-child|\* \+ \*/.test(s));
    expect(first.length).toBe(2);
    for (const s of first) expect(s).toMatch(/:where\(:not\(tr\)\)/);
  });
});
