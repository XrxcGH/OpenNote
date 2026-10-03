// @vitest-environment jsdom
// Highlighting never runs inside a transaction (PLAN.md section 10.5). A spy on the highlighter sees no call while
// 1,000 keys are typed, and colors map through the edits without flicker. Idle time then highlights the block
// once. Slow and very long blocks stay plain, and static code is colored with the same text.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockEditor } from '../extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../host';
import type { EditorHost } from '../host';
import { parseTextBlock } from '../markdown';
import { renderStatic } from '../schema/dom';
import { engine, grammarReady, kindOf, loadGrammar } from './engine';
import { highlightPlugin, highlightStatic } from './index';
import { findLanguage } from './languages';
import { loadEngine, MAX_LINES, tokenClass } from './plugin';

// jsdom has no layout, and ProseMirror measures a Range when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  // The test adds the plugin itself, so the code block doesn't load it a second time.
  flag: () => false,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

let idle: IdleRequestCallback[] = [];
const editors: Editor[] = [];

beforeEach(async () => {
  idle = [];
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => idle.push(callback));
  vi.stubGlobal('cancelIdleCallback', () => {});
  await loadEngine();
  await loadGrammar('javascript');
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs idle callbacks until none is left. */
function runIdle(timeRemaining = 50): number {
  let runs = 0;
  while (idle.length > 0 && runs < 100) {
    idle.shift()!({ didTimeout: false, timeRemaining: () => timeRemaining });
    runs++;
  }
  return runs;
}

function highlighted(markdown: string): Editor {
  const root = document.body.appendChild(document.createElement('div'));
  const editor = createBlockEditor(root, parseTextBlock(markdown), { kind: 'text', block: 'b1', host });
  editor.registerPlugin(highlightPlugin(host));
  editors.push(editor);
  return editor;
}

const colored = (editor: Editor, kind: Parameters<typeof tokenClass>[0]) =>
  [...editor.view.dom.querySelectorAll(`.${tokenClass(kind)}`)].map((span) => span.textContent);

describe('the highlight plugin', () => {
  it('colors code in idle time, with the grammar the block names', () => {
    const editor = highlighted('```js\nconst a = "s"; // note\n```');
    expect(colored(editor, 'keyword')).toEqual([]);
    runIdle();
    expect(colored(editor, 'keyword')).toEqual(['const']);
    expect(colored(editor, 'string')).toEqual(['"s"']);
    expect(colored(editor, 'comment')).toEqual(['// note']);
  });

  it('does no highlighting work in 1,000 typed keys, and keeps the colors in place meanwhile', () => {
    const editor = highlighted('```js\nconst a = 1;\n```\n\nafter');
    runIdle();
    const spy = vi.spyOn(engine, 'highlight');
    for (let i = 0; i < 1000; i++) {
      const end = editor.state.doc.firstChild!.nodeSize - 1;
      editor.view.dispatch(editor.state.tr.insertText(i % 50 === 49 ? '\n' : 'x', end));
      expect(colored(editor, 'keyword')).toEqual(['const']);
    }
    expect(spy).not.toHaveBeenCalled();
    runIdle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-highlights when the language changes, and clears colors for plain text', () => {
    const editor = highlighted('```js\nconst a = 1;\n```');
    runIdle();
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'language', null));
    expect(colored(editor, 'keyword')).toEqual(['const']);
    runIdle();
    expect(colored(editor, 'keyword')).toEqual([]);
  });

  it('turns a block off for the session when a highlight takes over 20 ms', () => {
    const editor = highlighted('```js\nconst a = 1;\n```');
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 25));
    const spy = vi.spyOn(engine, 'highlight');
    runIdle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(colored(editor, 'keyword')).toEqual([]);
    editor.view.dispatch(editor.state.tr.insertText('x', 2));
    runIdle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('leaves blocks over 10,000 lines plain', () => {
    const lines = Array.from({ length: MAX_LINES + 1 }, (_, i) => `let v${i} = ${i};`).join('\n');
    const editor = highlighted(`\`\`\`js\n${lines}\n\`\`\``);
    const spy = vi.spyOn(engine, 'highlight');
    runIdle();
    expect(spy).not.toHaveBeenCalled();
    expect(editor.view.dom.querySelector(`.${tokenClass('keyword')}`)).toBeNull();
  });

  it('highlights a long block in slices, one chunk per idle callback when idle time is short', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `let v${i} = ${i};`).join('\n');
    const editor = highlighted(`\`\`\`js\n${lines}\n\`\`\``);
    const spy = vi.spyOn(engine, 'highlight');
    // Time stands still, so a busy test machine can't trip the 20 ms guard.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(runIdle(0)).toBe(6);
    expect(spy).toHaveBeenCalledTimes(6);
    expect(colored(editor, 'keyword')).toHaveLength(3000);
  });
});

describe('static highlighting', () => {
  it('wraps the same text in colored spans', async () => {
    const doc: PMNode = parseTextBlock('Intro\n\n```js\nlet a = 2;\n```\n\n```\nplain\n```');
    const root = document.body.appendChild(document.createElement('div'));
    renderStatic(doc, root);
    const done = highlightStatic(root, doc);
    await vi.waitFor(() => {
      runIdle();
      expect(root.querySelector(`.${tokenClass('keyword')}`)?.textContent).toBe('let');
    });
    await done;
    const [js, plain] = root.querySelectorAll('pre > code');
    expect(js.textContent).toBe('let a = 2;');
    expect(plain.innerHTML).toBe('plain');
  });
});

describe('the grammar map', () => {
  it('maps highlight.js scopes to the eight code colors', () => {
    expect(kindOf(['hljs-title', 'class_'])).toBe('type');
    expect(kindOf(['hljs-title', 'function_'])).toBe('function');
    expect(kindOf(['hljs-variable', 'language_'])).toBe('keyword');
    expect(kindOf(['hljs-meta'])).toBe('punctuation');
    expect(kindOf(['hljs-unknown'])).toBeNull();
  });

  it('loads a grammar once, only when asked', async () => {
    const python = findLanguage('py')!;
    expect(python.name).toBe('Python');
    expect(grammarReady(python.grammar)).toBe(false);
    await loadGrammar(python.grammar);
    expect(grammarReady(python.grammar)).toBe(true);
  });
});
