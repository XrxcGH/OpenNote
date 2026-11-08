// Note numbering (R-FN-6, ADR 0087). Expected labels are hand-worked: Roman numerals, the Latin alphabet, and the
// Chicago Manual of Style's note symbols (*, dagger, double dagger, section sign, then doubled).
import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../markdown';
import { DEFAULT_NOTE_SETTINGS, noteLabel, numberNotes, readNoteSettings } from './numbering';
import type { NumberingBlock } from './numbering';
import { noteMarks, readNotes, refIdsInMarkdown } from './refs';

const id = (n: number) => `01m3sbcmt0000000000000n${String(n).padStart(3, '0')}`;

function block(name: string, markdown: string, notes: Record<string, unknown> = {}): NumberingBlock {
  return { id: name, marks: noteMarks(parseTextBlock(markdown)), notes: readNotes({ notes }) };
}

describe('numberNotes', () => {
  it('numbers endnotes in lowerRoman as i, ii, iii', () => {
    const end = (markdown: string) => ({ kind: 'end', markdown });
    const notes = { [id(1)]: end('One'), [id(2)]: end('Two'), [id(3)]: end('Three') };
    const page = [block('a', `A[^${id(1)}] b[^${id(2)}]`, notes), block('b', `C[^${id(3)}]`, notes)];
    const settings = readNoteSettings({ text: { notes: { end: { format: 'lowerRoman' } } } });
    expect(numberNotes(page, settings).end.map((note) => note.label)).toEqual(['i', 'ii', 'iii']);
    // lowerRoman is also the endnotes' default, as in Word.
    expect(numberNotes(page, DEFAULT_NOTE_SETTINGS).end.map((note) => note.label)).toEqual(['i', 'ii', 'iii']);
  });

  it('counts footnotes and endnotes apart, and a missing note as a footnote', () => {
    const notes = { [id(1)]: { kind: 'foot', markdown: 'F' }, [id(2)]: { kind: 'end', markdown: 'E' } };
    const page = [block('a', `x[^${id(1)}] y[^${id(2)}] z[^${id(3)}]`, notes)];
    const numbering = numberNotes(page, DEFAULT_NOTE_SETTINGS);
    expect(numbering.foot.map((note) => [note.id, note.label, note.markdown])).toEqual([
      [id(1), '1', 'F'],
      [id(3), '2', null],
    ]);
    expect(numbering.end.map((note) => note.label)).toEqual(['i']);
  });

  it('keeps the first number of a note referred to twice', () => {
    const page = [block('a', `x[^${id(1)}] y[^${id(2)}] z[^${id(1)}]`)];
    const numbering = numberNotes(page, DEFAULT_NOTE_SETTINGS);
    expect(numbering.foot.map((note) => note.label)).toEqual(['1', '2']);
  });

  it('starts at the start number and restarts at each level 1 heading when asked', () => {
    const markdown = `# One\n\nx[^${id(1)}] y[^${id(2)}]\n\n## Sub\n\nz[^${id(3)}]\n\n# Two\n\nw[^${id(4)}]`;
    const page = [block('a', markdown)];
    const restart = readNoteSettings({ text: { notes: { foot: { start: 5, restart: 'heading' } } } });
    expect(numberNotes(page, restart).foot.map((note) => note.label)).toEqual(['5', '6', '7', '5']);
    const continuous = readNoteSettings({ text: { notes: { foot: { start: 5 } } } });
    expect(numberNotes(page, continuous).foot.map((note) => note.label)).toEqual(['5', '6', '7', '8']);
  });
});

describe('noteLabel', () => {
  it('writes every format', () => {
    expect([1, 2, 3, 4, 9, 14].map((n) => noteLabel(n, 'upperRoman'))).toEqual(['I', 'II', 'III', 'IV', 'IX', 'XIV']);
    expect([1, 2, 26, 27].map((n) => noteLabel(n, 'lowerLetter'))).toEqual(['a', 'b', 'z', 'aa']);
    expect([1, 3].map((n) => noteLabel(n, 'upperLetter'))).toEqual(['A', 'C']);
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => noteLabel(n, 'chicago'))).toEqual(['*', '†', '‡', '§', '**', '††', '***']);
  });
});

describe('readNoteSettings', () => {
  it('reads an invalid value as missing (R-VIEW-4)', () => {
    const settings = readNoteSettings({ text: { notes: { foot: { format: 'emoji', start: -1, restart: 'page' } } } });
    expect(settings).toEqual(DEFAULT_NOTE_SETTINGS);
    expect(readNoteSettings(null)).toEqual(DEFAULT_NOTE_SETTINGS);
  });
});

describe('refIdsInMarkdown', () => {
  it('finds references but not escaped text or code', () => {
    const markdown = `a[^${id(1)}] \\[^${id(2)}] \`[^${id(3)}]\` b[^${id(4)}]`;
    expect(refIdsInMarkdown(markdown)).toEqual([id(1), id(4)]);
    expect(refIdsInMarkdown('plain text')).toEqual([]);
  });
});
