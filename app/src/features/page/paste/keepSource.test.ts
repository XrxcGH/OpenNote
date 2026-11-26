// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are test inputs or CSS for other apps, not design values.
// Keep source formatting (ADR 0084): the Word and Google Docs fixtures with fonts, sizes, colors, highlights,
// alignment, indents, and spacing. The expected values come from the CSS in the fixtures: 10.5pt is size 10.5, 36pt
// is an indent of 36, and `mso-highlight:yellow` is the color #ffff00 (CSS yellow, which is Word's highlight yellow).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizePaste } from './sanitize';
import type { PasteChoice, PasteDefaults } from './types';

const read = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const counter = () => {
  let next = 0;
  return () => `id${(next += 1)}`;
};
const keep = (html: string, mode?: PasteChoice, defaults?: PasteDefaults) =>
  sanitizePaste({ html }, { fidelity: true, mode, defaults, newId: counter() });

interface Run {
  text: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
interface Block {
  type: string;
  attrs: Record<string, unknown>;
  content?: Run[];
}

const docOf = (result: ReturnType<typeof sanitizePaste>) => {
  const piece = result.pieces[0];
  if (piece.kind !== 'text') throw new Error('expected text');
  return piece.doc.toJSON() as { content: Block[] };
};
const marksOf = (run: Run | undefined) => Object.fromEntries((run?.marks ?? []).map((m) => [m.type, m.attrs]));

describe('Word fixture, keep source formatting', () => {
  const doc = docOf(keep(read('word-v2.html'), 'keepSource'));
  const [first, second, third] = doc.content;

  it('reads size, font, color, alignment, spacing, and line spacing', () => {
    const run = first.content?.[0];
    expect(run?.text).toBe('Centered Georgia line');
    expect(marksOf(run)).toMatchObject({
      textSize: { size: '10.5' },
      font: { font: 'Georgia' },
      textColor: { color: '#c00000' },
    });
    expect(first.attrs).toMatchObject({ align: 'center', after: 6, line: { rule: 'multiple', value: 1.15 } });
  });

  it('reads the highlight, the hanging indent, spacing, small caps, and tracking', () => {
    expect(marksOf(second.content?.[0]).highlight).toEqual({ color: '#ffff00' });
    expect(second.attrs).toMatchObject({ indent: { start: 36, end: 0, first: -18 }, before: 12 });
    expect(marksOf(second.content?.[1])).toMatchObject({ caps: { caps: 'small' }, tracking: { tracking: '1' } });
  });

  it('keeps bold and a double underline, and no style or class reaches the page', () => {
    const runs = third.content ?? [];
    expect(marksOf(runs.find((r) => r.text === 'bold'))).toHaveProperty('bold');
    expect(marksOf(runs.find((r) => r.text.includes('double')))).toMatchObject({ underline: { line: 'double' } });
    expect(JSON.stringify(doc)).not.toMatch(/mso-|font-size|font-family|class=|MsoNormal/);
  });
});

describe('Google Docs fixture, keep source formatting', () => {
  const doc = docOf(keep(read('gdocs-v2.html'), 'keepSource'));

  it('reads Georgia 10.5 pt red, centered, with spacing', () => {
    const [first] = doc.content;
    expect(marksOf(first.content?.[0])).toMatchObject({
      textSize: { size: '10.5' },
      font: { font: 'Georgia' },
      textColor: { color: '#c00000' },
    });
    expect(first.attrs).toMatchObject({ align: 'center', before: 0, after: 8 });
  });

  it('reads the indent and the highlight, and drops black text and a transparent background', () => {
    const second = doc.content[1];
    expect(second.attrs).toMatchObject({ indent: { start: 36, end: 0, first: 0 } });
    const marks = marksOf(second.content?.[0]);
    expect(marks.highlight).toEqual({ color: '#ffff00' });
    expect(marks).not.toHaveProperty('textColor');
    expect(marksOf(doc.content[0].content?.[0])).not.toHaveProperty('highlight');
  });
});

describe('merge formatting and the other choices', () => {
  const defaults: PasteDefaults = {
    word: 'keepSource',
    docs: 'keepSource',
    onenote: 'keepSource',
    web: 'mergeFormatting',
  };

  it('gives today output exactly for the Word, Docs, and OneNote fixtures', () => {
    for (const name of ['word.html', 'word-v2.html', 'gdocs.html', 'gdocs-v2.html', 'onenote.html']) {
      const today = sanitizePaste({ html: read(name) }, { newId: counter() });
      const merged = keep(read(name), 'mergeFormatting');
      expect(merged.pieces).toEqual(today.pieces);
      expect(merged.choice).toBe('mergeFormatting');
    }
  });

  it('picks the default of the source that wrote the paste', () => {
    expect(keep(read('word-v2.html'), undefined, defaults).choice).toBe('keepSource');
    expect(keep(read('gdocs-v2.html'), undefined, { ...defaults, docs: 'textOnly' }).choice).toBe('textOnly');
    expect(keep(read('web.html'), undefined, defaults).choice).toBe('mergeFormatting');
  });

  it('leaves a web paste as it was when the setting is merge', () => {
    const today = sanitizePaste({ html: read('web.html') }, { newId: counter() });
    expect(keep(read('web.html'), undefined, defaults).pieces).toEqual(today.pieces);
  });

  it('keeps text only: one paragraph for each line, no marks', () => {
    const result = keep(read('word-v2.html'), 'textOnly');
    expect(result.choice).toBe('textOnly');
    const doc = docOf(result);
    expect(doc.content.every((block) => (block.content ?? []).every((run) => !run.marks))).toBe(true);
  });

  it('does not read paragraph formatting from a page that writes the attribute itself', () => {
    const html = `<p data-paste-para='{"align":"center"}'>Hello</p>`;
    for (const mode of ['keepSource', 'mergeFormatting'] as const) {
      expect(docOf(keep(html, mode)).content[0].attrs.align).toBeNull();
    }
  });

  it('does nothing different without the option', () => {
    const plain = sanitizePaste({ html: read('word-v2.html') }, { newId: counter() });
    expect(plain.choice).toBe('mergeFormatting');
    expect(JSON.stringify(plain.pieces)).not.toContain('"font"');
  });
});

describe('web paste, keep source formatting', () => {
  const page = '<p>See <span style="background-color:#ffff00">marked words</span> here</p>';
  const has = (result: ReturnType<typeof sanitizePaste>) =>
    JSON.stringify(docOf(result)).includes('"type":"highlight"');

  it('keeps a highlight, which the web normalizer no longer unwraps', () => {
    expect(has(keep(page, 'keepSource'))).toBe(true);
  });

  it('drops it under merge formatting, and never takes a highlight color from the markup itself', () => {
    expect(has(keep(page, 'mergeFormatting'))).toBe(false);
    const hostile = '<p>See <mark data-color="#ffff00">words</mark></p>';
    expect(has(keep(hostile, 'mergeFormatting'))).toBe(false);
    expect(has(keep(hostile, 'keepSource'))).toBe(false);
  });
});
