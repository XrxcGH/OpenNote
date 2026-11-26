// Walk-found layout rules in the tool windows and kits, read from the style sheets (touch targets, wrapping labels,
// table columns, hints). A browser run measures these too; this pins the declaration that fixes each one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FEATURES = join(import.meta.dirname, '..');
const ROOT = join(FEATURES, '..');

/** The declarations of every rule whose selector list holds `selector` exactly, joined. */
function rule(file: string, selector: string): string {
  const css = readFileSync(join(ROOT, file), 'utf8');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let found = '';
  for (const match of css.matchAll(pattern)) {
    const selectors = match[1]!
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((part) => part.trim());
    if (selectors.includes(selector)) found += match[2]!;
  }
  if (found === '') throw new Error(`${selector} not found in ${file}`);
  return found;
}

const TARGET = /min-block-size:\s*var\(--target-size\)/;
const TARGET_WIDE = /min-inline-size:\s*var\(--target-size\)/;

describe('walk layout rules', () => {
  it('T3-C06-1: chemistry fields line up their inputs and keep a wide column', () => {
    const grid = rule('features/tools/ui/chem.module.css', '.grid');
    expect(grid).toMatch(/align-items:\s*end/);
    expect(grid).toMatch(/minmax\(11rem/);
  });
  it('VB-3: a periodic table column is never narrower than its cell', () => {
    expect(rule('features/tools/ui/elements.module.css', '.table')).toMatch(
      /minmax\(max\(2rem, var\(--target-size\)\)/,
    );
  });
  it('VB-6: the math holder keeps room under its action row', () => {
    expect(rule('editor/extensions/mathDrawn.module.css', '.holderBlock')).toMatch(/padding-block-end/);
  });
  it('VB-8: the symbol copy switch wraps its label', () => {
    const copy = rule('features/tools/ui/symbols.module.css', '.copyMode');
    expect(copy).toMatch(/white-space:\s*normal/);
    expect(copy).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('VB-12: hints do not shrink a second time', () => {
    expect(rule('features/tools/signals/shared/kit.module.css', '.field small')).toMatch(/font-size:\s*inherit/);
    expect(rule('features/tools/humanities/ui/kit.module.css', '.field small')).toMatch(/font-size:\s*inherit/);
  });
  it('VB-16: tool tabs are as wide as a touch target', () => {
    expect(rule('features/tools/ui/tools.module.css', '.tab')).toMatch(TARGET_WIDE);
    expect(rule('features/tools/design/ui/design.module.css', '.tab')).toMatch(TARGET_WIDE);
  });
  it('VB-21: life-science inputs are as tall as a touch target', () => {
    expect(rule('features/tools/lifesys/ui/lifesys.module.css', '.input')).toMatch(TARGET);
  });
  it('VB-37: the reasoning restore link is as tall as a touch target', () => {
    expect(rule('features/tools/reasoning/ui/reasoning.module.css', '.linkButton')).toMatch(TARGET);
  });
  it('VB-71: the flashcard import file input is as tall as a touch target', () => {
    expect(rule('features/study/ui/study.module.css', ".field input[type='file']")).toMatch(TARGET);
  });
  it('VB-111: every details summary in the humanities kit is as tall as a touch target', () => {
    expect(rule('features/tools/humanities/ui/kit.module.css', '.plainDetails summary')).toMatch(TARGET);
  });
  it('VB-159: the aerospace unit select is as wide as a touch target', () => {
    expect(rule('features/engineering/aero/ui/kit.module.css', '.unit')).toMatch(TARGET_WIDE);
  });
  it('VB-189: the header actions stay on one line and the title gives way', () => {
    const buttons = rule('features/tools/ui/tools.module.css', '.header > button');
    expect(buttons).toMatch(/white-space:\s*nowrap/);
    expect(rule('features/tools/ui/tools.module.css', '.title')).toMatch(/text-overflow:\s*ellipsis/);
  });
});
