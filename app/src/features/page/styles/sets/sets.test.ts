// checks-disable-file brand-consistency: the colors of other apps' style sets are data, not this app's look
// The built-in style sets against their known-answer fixtures (text DESIGN.md 2.4, owner decision 10, NEXT-PLAN
// N5). Each set's resolved values must equal the values a separate reader takes from the fixture file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../../../theme/tokens';
import { resolveStyle } from '../resolve';
import { APP_STYLES, STYLE_SETS, setStylesForNotebook, styleSet, withStyleSet } from './index';
import type { StyleSetId } from './index';
import { readFixture } from './wordml';

const fixture = (file: string) => readFileSync(join(import.meta.dirname, 'fixtures', file), 'utf8');

function resolvedSet(id: StyleSetId, name: string) {
  const set = styleSet(id);
  if (!set) throw new Error(id);
  return resolveStyle({ app: APP_STYLES, notebook: set.styles, theme: [set.theme] }, name).values;
}

const FILES: readonly [StyleSetId, string][] = [
  ['word2016', 'word2016.xml'],
  ['word365', 'word365.xml'],
  ['googleDocs', 'googleDocs.xml'],
];

describe.each(FILES)('the %s set', (id, file) => {
  const expected = readFixture(fixture(file));

  it('defines every style its fixture defines', () => {
    expect(expected.size).toBeGreaterThanOrEqual(9);
    for (const name of expected.keys()) expect(Object.keys(styleSet(id)?.styles ?? {})).toContain(name);
  });

  it.each([...expected.keys()])('resolves %s to the fixture values', (name) => {
    const want = expected.get(name);
    const got = resolvedSet(id, name);
    expect({
      font: got.font,
      sizePt: got.sizePt,
      weight: got.weight,
      italic: got.italic,
      textColor: got.textColor,
      before: got.before,
      after: got.after,
      line: (got.line as { value: number }).value,
      align: got.align,
      tracking: got.tracking,
    }).toEqual({ ...want, indent: undefined });
    const indent = got.indent as { start: number; end: number } | undefined;
    expect(indent ? { start: indent.start, end: indent.end } : undefined).toEqual(want?.indent);
  });
});

describe('the Google Docs set', () => {
  it('matches the documented defaults of DESIGN.md 2.4', () => {
    const look = (name: string) => resolvedSet('googleDocs', name);
    expect([look('normal').font, look('normal').sizePt, look('normal').line]).toEqual([
      'Arial',
      11,
      { rule: 'multiple', value: 1.15 },
    ]);
    expect(look('title').sizePt).toBe(26);
    expect([look('subtitle').sizePt, look('subtitle').textColor]).toEqual([15, '#666666']);
    expect(look('h1').sizePt).toBe(20);
    expect([look('h3').sizePt, look('h3').textColor]).toEqual([14, '#434343']);
  });
});

describe('the OpenNote set', () => {
  const known = JSON.parse(fixture('opennote.json')) as {
    styles: Record<string, { size: keyof typeof tokens.type; weight?: keyof typeof tokens.font.weight }>;
  };
  it.each(Object.entries(known.styles))('takes %s from the type tokens', (name, spec) => {
    const look = resolvedSet('opennote', name);
    // Points are px x 3/4 on the 0.5 pt grid (SPEC D.3).
    expect(look.sizePt).toBe(Math.round(tokens.type[spec.size].size * 0.75 * 2) / 2);
    expect(look.weight).toBe(spec.weight ? tokens.font.weight[spec.weight] : 400);
  });
});

describe('choosing a set', () => {
  it('writes the set theme fonts in place of its tokens and keeps the app tokens', () => {
    const word = setStylesForNotebook(STYLE_SETS[1]);
    expect(word.h1.font).toBe('Calibri Light');
    expect(word.normal.font).toBe('Calibri');
    expect(setStylesForNotebook(STYLE_SETS[0]).h1.font).toBe('+heading');
  });

  it('keeps the notebook user styles', () => {
    const next = withStyleSet({ 'u-mine': { sizePt: 9 }, h1: { sizePt: 40 } }, STYLE_SETS[3]);
    expect(next['u-mine']).toEqual({ sizePt: 9 });
    expect(next.h1.sizePt).toBe(20);
  });
});
