// @vitest-environment jsdom
// The code editor's caret stays solid while the person types (steadyCaret.ts). The blink is a CSS animation that
// never ends, and while it ran every key waited for the next frame: the nightly perf-typing-gate's studio conditions.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerCodeEditorCommands } from './commands';
import { BLINK_AGAIN_MS, STEADY_CLASS } from './steadyCaret';
import { configureTestCommands, mount, unmountAll } from './testEditor';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});
afterEach(() => {
  vi.useRealTimers();
  unmountAll();
});

const layerOf = (root: HTMLElement) => {
  const layer = root.querySelector<HTMLElement>('.cm-cursorLayer');
  if (!layer) throw new Error('The editor draws no caret layer.');
  return layer;
};

describe('the steady caret', () => {
  it('stops the blink while keys come and starts it again after a pause', async () => {
    const editor = await mount({ text: 'value = 1\n' });
    const layer = layerOf(editor.view.dom);
    vi.useFakeTimers();
    for (const key of 'abc') {
      const at = editor.view.state.selection.main.head;
      const changes = { from: at, insert: key };
      editor.view.dispatch({ changes, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      vi.advanceTimersByTime(BLINK_AGAIN_MS / 2);
      expect(layer.classList.contains(STEADY_CLASS)).toBe(true);
    }
    vi.advanceTimersByTime(BLINK_AGAIN_MS);
    expect(layer.classList.contains(STEADY_CLASS)).toBe(false);
  });

  it('stays steady while the caret moves without typing', async () => {
    const editor = await mount({ text: 'value = 1\n', caret: 0 });
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(layerOf(editor.view.dom).classList.contains(STEADY_CLASS)).toBe(true);
  });

  it('turns the animation off with a rule that beats the inline name CodeMirror sets', async () => {
    const editor = await mount({ text: 'x' });
    const rules = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
    expect(rules).toMatch(new RegExp(`\\.cm-cursorLayer\\.${STEADY_CLASS}\\s*\\{\\s*animation:\\s*none !important`));
    expect(editor.view.dom.isConnected).toBe(true);
  });
});
