// @vitest-environment jsdom
// Edge cases of the text formatting commands (text DESIGN.md 4.1 and 4.2).
// They cover the painter's keyboard trigger, the device store's checks, select similar with the commands that follow
// it, and refused values. Expected values are worked by hand from the spec's rules.
import { Selection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeCase } from './changeCase';
import type { Command } from './command';
import { applyBullet } from './lists';
import { clearFormatting } from './marks';
import {
  checkedFormat,
  copiedFormat,
  forgetCopiedFormat,
  painterState,
  pasteFormatting,
  startPainter,
  stopPainter,
} from './painter';
import { clearAll, setAlign, setPara } from './paragraph';
import { runMarkPressed } from './runFormat';
import { RangesSelection, selectSimilar } from './similar';
import { TEXT_RUN_ENTRIES } from './textRunCatalog';
import { marked, markdownOf, mountEditor } from './testing';
import type { TestEditor } from './testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  stopPainter();
  forgetCopiedFormat();
  mounted?.destroy();
  mounted = null;
  localStorage.clear();
  vi.useRealTimers();
});

function run(state: EditorState, command: Command): EditorState | null {
  let tr: Transaction | null = null;
  const ran = command(state, (made) => (tr = made));
  return ran && tr ? state.apply(tr) : null;
}

/** "**a** b **c** d" with select similar run from the caret in "a": the two bold ranges. */
function similarState(source = '**[]a** b **c**'): EditorState {
  const selected = run(marked(source).state, selectSimilar());
  expect(selected?.selection).toBeInstanceOf(RangesSelection);
  return selected!;
}

describe('format painter', () => {
  it('waits for Shift to be released, so Shift+arrows can select more than one character', () => {
    vi.useFakeTimers();
    mounted = mountEditor('<span data-font="Georgia">[]x</span> abc');
    const { editor } = mounted;
    startPainter(editor);
    const keyup = (key: string, shiftKey: boolean) =>
      editor.view.dom.dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey, bubbles: true }));
    editor.commands.setTextSelection({ from: 3, to: 4 });
    keyup('ArrowRight', true);
    vi.runAllTimers();
    expect(painterState()).not.toBeNull();
    editor.commands.setTextSelection({ from: 3, to: 6 });
    keyup('ArrowRight', true);
    vi.runAllTimers();
    expect(painterState()).not.toBeNull();
    keyup('Shift', false);
    vi.runAllTimers();
    expect(painterState()).toBeNull();
    expect(mounted.markdown()).toBe('<span data-font="Georgia">x</span> <span data-font="Georgia">abc</span>');
  });
});

describe('the device store of copied formatting', () => {
  const stored = (value: unknown) => localStorage.setItem('opennote.formatPainter', JSON.stringify(value));

  it('counts a broken store as nothing copied', () => {
    stored({ marks: [null] });
    expect(copiedFormat()).toBeNull();
    expect(pasteFormatting()(marked('[a]').state)).toBe(false);
  });

  it('drops run formats outside the grammar and keeps valid ones', () => {
    stored({
      marks: [
        { type: 'textSize', attrs: { size: '99999' } },
        { type: 'link', attrs: { href: 'x' } },
        { type: 'nonsense', attrs: {} },
        { type: 'bold', attrs: {} },
      ],
    });
    expect(copiedFormat()).toEqual({ marks: [{ type: 'bold', attrs: {} }] });
    expect(markdownOf(run(marked('[a]').state, pasteFormatting())!)).toBe('**a**');
  });

  it('drops paragraph keys a reader would not keep, and a style that is not text', () => {
    expect(checkedFormat({ marks: [], para: { attrs: { align: 'center', before: 'lots' }, style: null } })).toEqual({
      marks: [],
      para: { attrs: { align: 'center' }, style: null },
    });
    expect(checkedFormat({ marks: [], para: { attrs: { align: 'center' }, style: 7 } })).toBeNull();
  });
});

describe('select similar, then a command', () => {
  it('changes the case of every range', () => {
    expect(markdownOf(run(similarState(), changeCase('upper'))!)).toBe('**A** b **C**');
  });

  it('formats the paragraphs of every range', () => {
    const selected = similarState('**[]a**\n\nb\n\n**c**');
    const after = run(selected, setAlign('center'))!;
    expect([0, 1, 2].map((i) => after.doc.child(i).attrs.align)).toEqual(['center', null, 'center']);
  });

  it('reports a format as mixed when only a later range has it', () => {
    const selected = similarState('**[]a** b **c**');
    const italic = run(
      selected,
      (state, dispatch) => (dispatch?.(state.tr.addMark(5, 6, state.schema.marks.italic.create())), true),
    )!;
    expect(runMarkPressed(italic, 'italic')).toBe('mixed');
  });

  it('round-trips the selection through JSON', () => {
    const selected = similarState();
    const back = Selection.fromJSON(selected.doc, selected.selection.toJSON());
    expect(back.eq(selected.selection)).toBe(true);
  });
});

describe('refused and unchanged commands', () => {
  it('clear formatting reports nothing applied on plain text', () => {
    expect(run(marked('[a]').state, clearFormatting())).toBeNull();
    expect(run(marked('[a]').state, clearAll())).toBeNull();
    expect(run(marked('[]a').state, clearFormatting())).toBeNull();
    expect(markdownOf(run(marked('**[a]**').state, clearFormatting())!)).toBe('a');
  });

  it('refuses a numeric font size outside 1 to 1638 or off the half-point grid', () => {
    const entry = TEXT_RUN_ENTRIES['format.fontSize'];
    for (const value of [Infinity, -5, 0, 1638.5, 10.25, Number.NaN]) {
      expect(entry.command({ value })).toBeNull();
    }
    expect(entry.command({ value: 10.5 })).not.toBeNull();
  });

  it('refuses an invisible bullet', () => {
    for (const code of [0x200b, 0x20, 0xa0, 0x301, 0xad, 0x2028]) {
      expect(run(marked('- []a').state, applyBullet(String.fromCodePoint(code)))).toBeNull();
    }
    expect(run(marked('- []a').state, applyBullet(String.fromCodePoint(0x2605)))).not.toBeNull();
  });

  it('stores only the keys a reader keeps for a paragraph value', () => {
    const after = run(marked('[]a').state, setPara('indent', { start: 36, end: 0, first: 0, evil: 1 }))!;
    expect(after.doc.child(0).attrs.indent).toEqual({ start: 36, end: 0, first: 0 });
  });
});
