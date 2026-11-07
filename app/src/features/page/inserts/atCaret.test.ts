// @vitest-environment jsdom
// A kit's Insert answer, steps, and equation add to the page. A later insert never replaces an earlier one, and each
// is an undo step of its own.
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { META_COMMAND } from '../../../editor/meta';
import { insertMathAtCaret, insertTextAtCaret } from './atCaret';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const kinds = (page: TestEditor): string[] => {
  const out: string[] = [];
  page.editor.state.doc.forEach((node) => out.push(node.type.name));
  return out;
};

describe('inserts at the caret', () => {
  it('keeps an equation when an answer line is inserted after it', () => {
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    expect(insertMathAtCaret(mounted.editor, 'x=2', true)).toBe(true);
    expect(insertTextAtCaret(mounted.editor, 'x = 2')).toBe(true);
    expect(kinds(mounted)).toEqual(['paragraph', 'mathBlock', 'paragraph']);
    expect(mounted.editor.state.doc.lastChild?.textContent).toBe('x = 2');
  });

  it('keeps an equation and an answer line when the steps follow', () => {
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    insertMathAtCaret(mounted.editor, 'x=2', true);
    insertTextAtCaret(mounted.editor, 'x = 2');
    expect(insertTextAtCaret(mounted.editor, '<ol><li><p>Divide by 3</p></li></ol>')).toBe(true);
    expect(kinds(mounted)).toEqual(['paragraph', 'mathBlock', 'paragraph', 'orderedList']);
  });

  it('puts a second equation after the first, not over it', () => {
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    insertMathAtCaret(mounted.editor, 'a=1', true);
    insertMathAtCaret(mounted.editor, 'b=2', true);
    const sources: string[] = [];
    mounted.editor.state.doc.descendants((node) => {
      if (node.type.name === 'mathBlock') sources.push(node.attrs.source as string);
    });
    expect(sources).toEqual(['a=1', 'b=2']);
  });

  it('still replaces a word the person selected', () => {
    mounted = mountEditor('The answer is [here] now');
    expect(insertTextAtCaret(mounted.editor, '42')).toBe(true);
    expect(mounted.editor.state.doc.textContent).toBe('The answer is 42 now');
  });

  it('sends each insert as a command, a step of its own', () => {
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    const metas: unknown[] = [];
    mounted.editor.on('transaction', ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) metas.push(transaction.getMeta(META_COMMAND));
    });
    insertTextAtCaret(mounted.editor, 'one');
    insertTextAtCaret(mounted.editor, 'two');
    expect(metas).toEqual([true, true]);
  });
});

// The shape the kits' stepsHtml gives: the title, then a numbered list whose item holds the words and a math block.
const STEPS = '<p>Worked steps</p><ol><li><p>Divide by 3</p><div data-math-block="x=6/3"></div></li></ol>';

describe('worked steps', () => {
  it('adds the kit steps after an equation and keeps the steps own math', () => {
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    insertMathAtCaret(mounted.editor, 'x=2', true);
    const html = STEPS;
    expect(insertTextAtCaret(mounted.editor, html)).toBe(true);
    expect(insertTextAtCaret(mounted.editor, html)).toBe(true);
    const sources: string[] = [];
    mounted.editor.state.doc.descendants((node) => {
      if (node.type.name === 'mathBlock') sources.push(node.attrs.source as string);
    });
    expect(sources).toEqual(['x=2', 'x=6/3', 'x=6/3']);
    expect(kinds(mounted).filter((kind) => kind === 'orderedList')).toHaveLength(2);
  });
});

describe('after worked steps', () => {
  it('puts an answer line below the steps and a second steps list after it', () => {
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    const html = STEPS;
    insertTextAtCaret(mounted.editor, html);
    insertTextAtCaret(mounted.editor, 'x = 2');
    insertTextAtCaret(mounted.editor, html);
    expect(kinds(mounted)).toEqual(['paragraph', 'paragraph', 'orderedList', 'paragraph', 'paragraph', 'orderedList']);
  });

  it('puts an answer on its own line below a heading, never into the title', () => {
    mounted = mountEditor('## Saturday, October 31, 2026');
    mounted.editor.commands.focus('end');
    expect(insertTextAtCaret(mounted.editor, '4')).toBe(true);
    expect(kinds(mounted)).toEqual(['heading', 'paragraph']);
    expect(mounted.editor.state.doc.firstChild?.textContent).toBe('Saturday, October 31, 2026');
    expect(mounted.editor.state.doc.lastChild?.textContent).toBe('4');
  });

  it('puts a display equation below a heading', () => {
    mounted = mountEditor('## Work');
    mounted.editor.commands.focus('end');
    expect(insertMathAtCaret(mounted.editor, 'x=2', true)).toBe(true);
    // The page may add a line after a closing equation; the equation itself comes straight after the heading.
    expect(kinds(mounted).slice(0, 2)).toEqual(['heading', 'mathBlock']);
  });
});
