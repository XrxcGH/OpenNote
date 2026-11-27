// @vitest-environment jsdom
// The studio's checks publish a file's problems again after each key (problems.ts). Problems the editor shows already
// are not drawn again: drawing them drew the gutter and a frame just before the next key, the nightly
// perf-typing-gate's studio conditions.
import { forEachDiagnostic } from '@codemirror/lint';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../contracts';
import { registerCodeEditorCommands } from './commands';
import { configureTestCommands, mount, unmountAll } from './testEditor';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});
afterEach(unmountAll);

const TEXT = 'value = 1\nthe quick ';
const problem = (from: number, message = 'Invalid syntax'): Diagnostic => ({
  file: 'main.py',
  from,
  to: from + 5,
  severity: 'error',
  code: 'syntax',
  message,
  source: 'lezer',
});

const shown = (editor: Awaited<ReturnType<typeof mount>>) => {
  const found: string[] = [];
  forEachDiagnostic(editor.view.state, (item, from, to) => found.push(`${from}-${to} ${item.message}`));
  return found;
};

describe('problems published again', () => {
  it('are not drawn again while text is typed after them', async () => {
    const editor = await mount({ language: 'python', text: TEXT });
    editor.showProblems([problem(14)]);
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    for (const key of 'brown ') {
      editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: key } });
      editor.showProblems([problem(14)]);
    }
    // The six keys, and no redraw of the problem.
    expect(dispatch).toHaveBeenCalledTimes(6);
    expect(shown(editor)).toEqual(['14-19 Invalid syntax (syntax)']);
  });

  it('are drawn again when they change, or when text before them moved them', async () => {
    const editor = await mount({ language: 'python', text: TEXT });
    editor.showProblems([problem(14)]);
    editor.showProblems([problem(14, 'Unexpected name')]);
    expect(shown(editor)).toEqual(['14-19 Unexpected name (syntax)']);
    editor.view.dispatch({ changes: { from: 0, insert: '#\n' } });
    editor.showProblems([problem(16, 'Unexpected name')]);
    expect(shown(editor)).toEqual(['16-21 Unexpected name (syntax)']);
    editor.showProblems([]);
    expect(shown(editor)).toEqual([]);
  });
});
