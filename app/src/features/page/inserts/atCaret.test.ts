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

describe('worked steps', () => {
  it('adds the kit steps after an equation and keeps the steps own math', async () => {
    const { stepsHtml } = await import('../../tools/kits/ui/words');
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    insertMathAtCaret(mounted.editor, 'x=2', true);
    const html = stepsHtml([{ key: 'kits.steps.title', math: 'x=6/3' }] as never);
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
  it('puts an answer line below the steps and a second steps list after it', async () => {
    const { stepsHtml } = await import('../../tools/kits/ui/words');
    mounted = mountEditor('Work:');
    mounted.editor.commands.focus('end');
    const html = stepsHtml([{ key: 'kits.steps.title', math: 'x=6/3' }] as never);
    insertTextAtCaret(mounted.editor, html);
    insertTextAtCaret(mounted.editor, 'x = 2');
    insertTextAtCaret(mounted.editor, html);
    expect(kinds(mounted)).toEqual(['paragraph', 'paragraph', 'orderedList', 'paragraph', 'paragraph', 'orderedList']);
  });
});
