// @vitest-environment jsdom
// The symbol dialog's logic, Alt+X, the special characters, the size of the name list, and Show formatting marks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSymbolData } from '../../../../scripts/unicode/generate';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { formattingMarks, marksFor, shownMarks } from '../../../editor/extensions/invisibles';
import { altX, altXSelected } from './altx';
import { SPECIAL, insertChar, runAltX } from './commands';
import { codeOf, flatten, gridMove, hexOf, pushRecent, readRecent, searchSymbols, writeRecent } from './model';
import type { SymbolData } from './model';

const DATA_PATH = join(import.meta.dirname, 'symbolData.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as SymbolData;
const all = flatten(data);

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
  formattingMarks.set(false);
});

function mount(source: string): TestEditor {
  mounted = mountEditor(source);
  return mounted;
}

/** Puts the caret at the end of the first paragraph. */
function caretAtEnd(page: TestEditor): void {
  page.editor.commands.setTextSelection(page.editor.state.doc.firstChild!.nodeSize - 1);
}

const EM_DASH = String.fromCodePoint(0x2014);
const GRIN = String.fromCodePoint(0x1f600);

describe('Alt+X', () => {
  it('turns 2014 into an em dash and an em dash into 2014', () => {
    expect(altX('2014')).toEqual({ length: 4, replacement: EM_DASH });
    expect(altX(EM_DASH)).toEqual({ length: 1, replacement: '2014' });
  });

  it('turns 1F600 into the grinning face and back', () => {
    expect(altX('1F600')).toEqual({ length: 5, replacement: GRIN });
    expect(altX(GRIN)).toEqual({ length: 2, replacement: '1F600' });
  });

  it('takes a U+ prefix with the digits, and only the digits after other text', () => {
    expect(altX('x U+00e9')).toEqual({ length: 6, replacement: String.fromCodePoint(0xe9) });
    expect(altX('price 20AC')).toEqual({ length: 4, replacement: String.fromCodePoint(0x20ac) });
  });

  it('skips codes that are not characters and uses a shorter run', () => {
    // 110000 is past the last code point, so the last five digits (10000) are used.
    expect(altX('110000')).toEqual({ length: 5, replacement: String.fromCodePoint(0x10000) });
    // D800 is a surrogate, so the last three digits (800) are used.
    expect(altX('D800')).toEqual({ length: 3, replacement: String.fromCodePoint(0x800) });
    expect(altX('')).toBeNull();
  });

  it('converts exactly a selection', () => {
    expect(altXSelected('xyz')).toBeNull();
    expect(altXSelected('2014')).toBe(EM_DASH);
    expect(altXSelected(String.fromCodePoint(0xe9))).toBe('00E9');
  });

  it('works in an editor, both ways', () => {
    const page = mount('Dash: 2014');
    caretAtEnd(page);
    expect(runAltX(page.editor)).toBe(true);
    expect(page.markdown()).toBe('Dash: ' + EM_DASH);
    expect(runAltX(page.editor)).toBe(true);
    expect(page.markdown()).toBe('Dash: 2014');
  });

  it('turns 1F600 into the grinning face in an editor', () => {
    const page = mount('Smile 1F600');
    caretAtEnd(page);
    runAltX(page.editor);
    expect(page.markdown()).toBe('Smile ' + GRIN);
  });
});

describe('the special characters', () => {
  it.each([
    ['nbsp', 0xa0],
    ['nbHyphen', 0x2011],
    ['softHyphen', 0xad],
    ['emDash', 0x2014],
    ['enDash', 0x2013],
  ] as const)('inserts %s at the caret', (name, code) => {
    const char = String.fromCodePoint(code);
    expect(SPECIAL[name]).toBe(char);
    const page = mount('ab');
    caretAtEnd(page);
    insertChar(page.editor, SPECIAL[name]);
    expect(page.editor.state.doc.textContent).toBe('ab' + char);
  });
});

describe('Alt+X refuses non-text codes', () => {
  it('does not turn 0a, 1b, fffe or fffc into characters', () => {
    // U+000A is a line feed, U+001B an escape, U+FFFE a noncharacter, U+FFFC the object placeholder (Unicode charts).
    expect(altX('0a')).toEqual({ length: 1, replacement: '0061' });
    expect(altX('x1b')).toEqual({ length: 1, replacement: '0062' });
    expect(altX('fffe')).toEqual({ length: 3, replacement: String.fromCodePoint(0xffe) });
    expect(altX('fffc')).toEqual({ length: 3, replacement: String.fromCodePoint(0xffc) });
    expect(altXSelected('0a')).toBeNull();
  });
});

describe('the name list', () => {
  it('treats CENTER as CENTRE and applies the group to a single character', () => {
    expect(searchSymbols(all, 'center line', null).some((e) => e.name.includes('CENTRE LINE'))).toBe(true);
    expect(searchSymbols(all, String.fromCodePoint(0xe9), 'arrows')).not.toContainEqual(
      expect.objectContaining({ cp: 0xe9 }),
    );
  });

  it('lists U+2192 RIGHTWARDS ARROW when searching for arrow', () => {
    const found = searchSymbols(all, 'arrow', null);
    const right = found.find((e) => e.cp === 0x2192);
    expect(right?.name).toBe('RIGHTWARDS ARROW');
    expect(found.length).toBeGreaterThan(50);
  });

  it('finds by code, by pasted character, and by several words', () => {
    expect(searchSymbols(all, 'U+20AC', null)[0]?.name).toBe('EURO SIGN');
    expect(searchSymbols(all, String.fromCodePoint(0xe9), null)[0]?.cp).toBe(0xe9);
    expect(searchSymbols(all, 'greek small alpha', null).some((e) => e.cp === 0x3b1)).toBe(true);
  });

  it('filters by group and covers the characters the help names', () => {
    expect(searchSymbols(all, 'arrow', 'currency')).toEqual([]);
    for (const cp of [0xa9, 0xb0, 0x20ac, 0x2014, 0x2192, 0x221e, 0x3c0, 0x1f600]) {
      expect(
        all.some((e) => e.cp === cp),
        hexOf(cp),
      ).toBe(true);
    }
    expect(codeOf('zz')).toBeNull();
    expect(codeOf('D800')).toBeNull();
  });

  it('keeps recent symbols newest first, once each, up to a limit', () => {
    expect(pushRecent([1, 2, 3], 2)).toEqual([2, 1, 3]);
    expect(
      pushRecent(
        Array.from({ length: 16 }, (_, i) => i + 1),
        99,
      ),
    ).toHaveLength(16);
    let saved = '';
    writeRecent([5, 6], { setItem: (_k, v) => void (saved = v) });
    expect(readRecent({ getItem: () => saved })).toEqual([5, 6]);
    expect(readRecent({ getItem: () => 'not json' })).toEqual([]);
  });

  it('stays under 80 KB gzip', () => {
    const bytes = gzipSync(readFileSync(DATA_PATH)).length;
    expect(bytes).toBeLessThan(80 * 1024);
  });

  it('matches what the generator writes from the pinned data', () => {
    expect(readFileSync(DATA_PATH, 'utf8')).toBe(renderSymbolData());
  });
});

describe('Show formatting marks', () => {
  it('adds decorations only and never changes the Markdown', () => {
    const page = mount('a b' + String.fromCodePoint(0xa0) + 'c' + String.fromCodePoint(0xad) + 'y');
    const before = page.markdown();
    const docBefore = page.editor.state.doc;
    formattingMarks.set(true);
    const kinds = [...page.root.querySelectorAll('[data-fmark]')].map((el) => el.getAttribute('data-fmark'));
    expect(kinds).toEqual(expect.arrayContaining(['space', 'nbsp', 'shy', 'para']));
    expect(page.markdown()).toBe(before);
    expect(page.editor.state.doc.eq(docBefore)).toBe(true);
    expect(page.root.querySelector('[data-fmark="para"]')?.textContent).toBe('');
    formattingMarks.set(false);
    expect(page.root.querySelectorAll('[data-fmark]')).toHaveLength(0);
  });

  it('marks tabs and follows typing', () => {
    const page = mount('x');
    formattingMarks.set(true);
    caretAtEnd(page);
    insertChar(page.editor, String.fromCharCode(9));
    insertChar(page.editor, ' ');
    const kinds = [...page.root.querySelectorAll('[data-fmark]')].map((el) => el.getAttribute('data-fmark'));
    expect(kinds).toEqual(expect.arrayContaining(['tab', 'space']));
  });
});

describe('Alt+X leaves atoms alone', () => {
  /** Finds the first node of a type in the document, with its position. */
  function find(doc: PMNode, test: (node: PMNode) => boolean): { node: PMNode; pos: number } {
    let found: { node: PMNode; pos: number } | null = null;
    doc.descendants((node, pos) => {
      if (!found && test(node)) found = { node, pos };
      return !found;
    });
    if (!found) throw new Error('No such node.');
    return found;
  }

  it('does nothing right after a hard break', () => {
    const page = mount('a');
    const { schema } = page.editor;
    const br = schema.nodes['hardBreak'];
    if (!br) throw new Error('No hard break.');
    page.editor.view.dispatch(page.editor.state.tr.insert(2, [br.create(), schema.text('b')]));
    const { pos } = find(page.editor.state.doc, (n) => n.type === br);
    page.editor.commands.setTextSelection(pos + 1);
    const before = page.editor.state.doc;
    expect(runAltX(page.editor)).toBe(false);
    expect(page.editor.state.doc.eq(before)).toBe(true);
  });

  it('does nothing right after an inline equation, and when one is selected', () => {
    const page = mount('x $a$');
    const eq = find(page.editor.state.doc, (n) => n.isInline && n.isAtom && !n.isText);
    const before = page.editor.state.doc;
    page.editor.commands.setTextSelection(eq.pos + eq.node.nodeSize);
    expect(runAltX(page.editor)).toBe(false);
    page.editor.view.dispatch(page.editor.state.tr.setSelection(NodeSelection.create(page.editor.state.doc, eq.pos)));
    expect(runAltX(page.editor)).toBe(false);
    expect(page.editor.state.doc.eq(before)).toBe(true);
  });

  it('does nothing when the selection spans two paragraphs', () => {
    const page = mount('x 20\n\n14 y');
    const doc = page.editor.state.doc;
    expect(doc.childCount).toBe(2);
    const first = doc.child(0).nodeSize;
    page.editor.view.dispatch(page.editor.state.tr.setSelection(TextSelection.create(doc, first - 3, first + 3)));
    const before = page.editor.state.doc;
    expect(runAltX(page.editor)).toBe(false);
    expect(page.editor.state.doc.eq(before)).toBe(true);
  });
});

describe('the symbol grid keys', () => {
  it('moves by cell, row and page, and stops at the ends', () => {
    expect(gridMove('ArrowRight', 0, 20, 5)).toBe(1);
    expect(gridMove('ArrowLeft', 0, 20, 5)).toBe(0);
    expect(gridMove('ArrowDown', 3, 20, 5)).toBe(8);
    expect(gridMove('ArrowUp', 3, 20, 5)).toBe(0);
    expect(gridMove('PageDown', 2, 30, 5)).toBe(22);
    expect(gridMove('PageUp', 25, 30, 5)).toBe(5);
    expect(gridMove('Home', 7, 20, 5)).toBe(0);
    expect(gridMove('End', 7, 20, 5)).toBe(19);
    expect(gridMove('ArrowDown', 18, 20, 5)).toBe(19);
    expect(gridMove('a', 1, 20, 5)).toBeNull();
  });
});

describe('the formatting marks while typing', () => {
  const words = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
  const text = Array.from({ length: 120 }, () => words).join('\n\n');
  const summary = (set: ReturnType<typeof marksFor>, doc: PMNode) =>
    set
      .find(0, doc.content.size)
      .map((d) => `${d.from}-${d.to}`)
      .sort();

  it('keeps the marks equal to a full redraw after edits, joins and splits', () => {
    const page = mount('one two\n\nthree four\n\nfive');
    formattingMarks.set(true);
    const { editor } = page;
    const edits = [
      () => insertChar(editor, ' '),
      () => insertChar(editor, SPECIAL.nbsp),
      () => editor.commands.splitBlock(),
      () => editor.commands.setTextSelection(1),
      () => editor.commands.joinForward(),
      () => editor.commands.deleteRange({ from: 2, to: 6 }),
      () => editor.commands.deleteRange({ from: 1, to: 3 }),
    ];
    for (const edit of edits) {
      edit();
      const state = editor.state;
      const shown = shownMarks(state);
      expect(summary(shown, state.doc)).toEqual(summary(marksFor(state.doc), state.doc));
    }
  });

  it('redraws only the touched block: typing stays fast on a long page', () => {
    const page = mount(text);
    formattingMarks.set(true);
    const { editor } = page;
    editor.commands.setTextSelection(editor.state.doc.content.size / 2);
    const times: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const start = performance.now();
      insertChar(editor, i % 2 ? ' ' : 'a');
      times.push(performance.now() - start);
    }
    times.sort((x, y) => x - y);
    // A full redraw of 120 paragraphs of 60 words costs more than 16 ms a key here; one block costs a few.
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(16);
  });
});

describe('the glyph probe', () => {
  it('measures each character once per font, however often the filter runs', async () => {
    vi.resetModules();
    let fontSets = 0;
    const context = {
      set font(_value: string) {
        fontSets += 1;
      },
      measureText: () => ({ width: 10 }),
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const model = await import('./model');
    for (let round = 0; round < 5; round += 1) {
      for (const char of ['a', 'b', 'c']) model.fontHasGlyph('Cambria Math', char);
    }
    expect(fontSets).toBe(6);
    model.fontHasGlyph('Symbol', 'a');
    expect(fontSets).toBe(8);
    spy.mockRestore();
  });
});
