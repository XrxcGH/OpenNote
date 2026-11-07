// @vitest-environment jsdom
// The symbol dialog's logic, Alt+X, the special characters, the size of the name list, and Show formatting marks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { renderSymbolData } from '../../../../scripts/unicode/generate';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { formattingMarks } from '../../../editor/extensions/invisibles';
import { altX, altXSelected } from './altx';
import { SPECIAL, insertChar, runAltX } from './commands';
import { codeOf, flatten, hexOf, pushRecent, readRecent, searchSymbols, writeRecent } from './model';
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

describe('the name list', () => {
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
