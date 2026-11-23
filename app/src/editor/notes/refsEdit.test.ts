// Typing plain words must not parse the whole block for references on each key (B12 typing gate), and an edit that
// can change a reference must still be parsed.
import { describe, expect, it, vi } from 'vitest';
import * as refs from './refs';
import { editKeepsMarks, editKeepsRefs } from '../markdown/plainEdit';
import { NotesModel } from './model';

const far = `${'word '.repeat(100)}[^0abcdefghjkmnpqrstvwxyz123]${' word'.repeat(100)}`;

describe('editKeepsRefs', () => {
  it('accepts a plain word typed far from a reference', () => {
    expect(editKeepsRefs(far, `x${far}`)).toBe(true);
    expect(editKeepsRefs('plain text', 'plain texts')).toBe(true);
  });

  it('rejects edits that can change a reference', () => {
    expect(editKeepsRefs('see [^0abcdefghjkmnpqrstvwxyz123]', 'see [^abc12]')).toBe(false);
    expect(editKeepsRefs('see [^0abcdefghjkmnpqrstvwxyz123] here', 'see [^0abcdefghjkmnpqrstvwxyz123]x here')).toBe(
      false,
    );
    expect(editKeepsRefs('a [^0abcdefghjkmnpqrstvwxyz123]', 'a `[^0abcdefghjkmnpqrstvwxyz123]')).toBe(false);
    expect(editKeepsRefs('a [^0abcdefghjkmnpqrstvwxyz123]', 'a [^0abcdefghjkmnpqrstvwxyz123]\n')).toBe(false);
    expect(editKeepsRefs('[^0abcdefghjkmnpqrstvwxyz123] a', '    [^0abcdefghjkmnpqrstvwxyz123] a')).toBe(false);
  });
});

describe('editKeepsRefs indentation', () => {
  const id = '[^0abcdefghjkmnpqrstvwxyz123]';
  it('rejects a space that makes a line an indented code block', () => {
    const before = `a

   ${'x'.repeat(40)}${id}`;
    const after = `a

    ${'x'.repeat(40)}${id}`;
    expect(refs.refIdsInMarkdown(before)).toEqual(['0abcdefghjkmnpqrstvwxyz123']);
    expect(refs.refIdsInMarkdown(after)).toEqual([]);
    expect(editKeepsRefs(before, after)).toBe(false);
  });

  it('never says unchanged when a full parse finds different references (fuzz)', () => {
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pieces = [
      ' ',
      '  ',
      'w',
      'word ',
      `
`,
      `	`,
      '    ',
      id,
      '`',
      'x'.repeat(40),
    ];
    for (let i = 0; i < 4000; i += 1) {
      let text = '';
      for (let k = 0; k < 1 + next(6); k += 1) text += pieces[next(pieces.length)];
      const at = next(text.length + 1);
      const put = pieces[next(pieces.length)] ?? '';
      const cut = next(3);
      const after = text.slice(0, at) + put + text.slice(at + cut);
      if (editKeepsRefs(text, after)) {
        expect(refs.refIdsInMarkdown(after), JSON.stringify([text, after])).toEqual(refs.refIdsInMarkdown(text));
      }
    }
  });
});

describe('NotesModel.rider', () => {
  it('parses the block once for a run of plain keystrokes', () => {
    const model = new NotesModel();
    model.setBlock('b', { '0abcdefghjkmnpqrstvwxyz123': { kind: 'foot', markdown: 'Note.' } });
    const spy = vi.spyOn(refs, 'refIdsInMarkdown');
    let text = far;
    model.rider('b', text, `${text} `);
    text = `${text} `;
    spy.mockClear();
    for (const key of 'abcdef') {
      model.rider('b', text, `${text}${key}`);
      text += key;
    }
    expect(spy).not.toHaveBeenCalled();
    // Removing the reference still takes its note along.
    const edits = model.rider('b', text, 'gone');
    expect(edits).toHaveLength(1);
  });
});

describe('editKeepsMarks', () => {
  const span = '<span data-comment="0abcdefghjkmnpqrstvwxyz123">checked words</span>';
  it('accepts typing in text, also inside a marked range', () => {
    expect(editKeepsMarks(`before ${span} after`, `before x${span} after`)).toBe(true);
    expect(editKeepsMarks(`before ${span} after`, `before ${span.replace('checked', 'checkedx')} after`)).toBe(true);
  });

  it('rejects typing inside a tag or with a tag character', () => {
    expect(editKeepsMarks(span, span.replace('data-comment', 'data-commentx'))).toBe(false);
    expect(editKeepsMarks(span, `${span}<`)).toBe(false);
  });
});
