// @vitest-environment jsdom
// Number this equation, Number all equations, and Remove equation number act on the equation at the caret.
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from '../../editor/commands/testing';
import type { TestEditor } from '../../editor/commands/testing';
import { choicesIn, numberAllEquations, numberEquation, unnumberEquation } from './equationCommands';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const SOURCE = 'Intro.\n\n$$\na=1\n$$\n\n$$\nb=2\n$$\n\nAfter.';

const sources = (page: TestEditor): string[] => {
  const out: string[] = [];
  page.editor.state.doc.descendants((node) => {
    if (node.type.name === 'mathBlock') out.push(node.attrs.source as string);
  });
  return out;
};

const selectBlock = (page: TestEditor, index: number): void => {
  let at = -1;
  let seen = -1;
  page.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'mathBlock' && (seen += 1) === index) at = pos;
  });
  page.editor.view.dispatch(page.editor.state.tr.setSelection(NodeSelection.create(page.editor.state.doc, at)));
};

describe('the equation commands', () => {
  it('numbers the selected equation with a free label', () => {
    mounted = mountEditor(SOURCE);
    selectBlock(mounted, 1);
    expect(numberEquation(mounted.editor)).toBe(true);
    expect(sources(mounted)).toEqual(['a=1', 'b=2 \\label{eq-1}']);
    expect(choicesIn(mounted.editor)).toEqual([{ key: 'eq-1', number: 1, source: 'b=2' }]);
  });

  it('does not number twice, and removes a number', () => {
    mounted = mountEditor(SOURCE);
    selectBlock(mounted, 0);
    numberEquation(mounted.editor);
    numberEquation(mounted.editor);
    expect(sources(mounted)[0]).toBe('a=1 \\label{eq-1}');
    expect(unnumberEquation(mounted.editor)).toBe(true);
    expect(sources(mounted)[0]).toBe('a=1');
    expect(unnumberEquation(mounted.editor)).toBe(false);
  });

  it('numbers every equation, keeping labels that exist', () => {
    mounted = mountEditor('$$\na=1 \\label{eq-1}\n$$\n\n$$\nb=2\n$$\n\n$$\nc=3\n$$');
    expect(numberAllEquations(mounted.editor)).toBe(2);
    expect(sources(mounted)).toEqual(['a=1 \\label{eq-1}', 'b=2 \\label{eq-2}', 'c=3 \\label{eq-3}']);
    expect(numberAllEquations(mounted.editor)).toBe(0);
  });

  it('uses the equation nearest the caret', () => {
    mounted = mountEditor('$$\na=1\n$$\n\nAfter.');
    mounted.editor.commands.setTextSelection(mounted.editor.state.doc.content.size - 1);
    expect(numberEquation(mounted.editor)).toBe(true);
    expect(sources(mounted)).toEqual(['a=1 \\label{eq-1}']);
  });

  it('says so when no equation is near the caret', () => {
    mounted = mountEditor('Just text.');
    expect(numberEquation(mounted.editor)).toBe(false);
    expect(sources(mounted)).toEqual([]);
  });
});
