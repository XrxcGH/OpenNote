// Test helpers for WP4's editor tests (owner: WP4): a host that records what it was asked, and an editor over
// Markdown. Brackets mark the selection as in the page helpers' `md`: "a [b] c" selects "b", "a [] c" is a caret.
import type { Editor } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createBlockEditor } from '../extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../host';
import type { EditingSettingsView, EditorHost } from '../host';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../markdown';
import type { Command } from './command';

export interface TestHost extends EditorHost {
  readonly announced: string[];
  readonly selected: { blocks: readonly string[]; reason: string }[];
  menuAnswer: string | null;
  editing: EditingSettingsView;
}

export function testHost(overrides: Partial<EditorHost> = {}): TestHost {
  const host: TestHost = {
    announced: [],
    selected: [],
    menuAnswer: null,
    editing: { ...DEFAULT_EDITING_VIEW },
    settings: () => host.editing,
    flag: () => true,
    announce: (text) => void host.announced.push(text),
    openMenu: () => Promise.resolve(host.menuAnswer),
    screenReader: () => false,
    spelling: () => null,
    selectBlocks: (blocks, reason) => void host.selected.push({ blocks, reason }),
    ...overrides,
  };
  return host;
}

const ANCHOR = '';
const HEAD = '';

/** Markdown with "[" and "]" marking the selection, parsed, with the selection's positions. */
export function marked(source: string): { state: EditorState } {
  const markers = [...source.matchAll(/\[/g)]
    .map((match) => ({ open: match.index, close: source.indexOf(']', match.index) }))
    .find(({ open, close }) => close !== -1 && !/^\[[ xX!]/.test(source.slice(open)) && source[close + 1] !== '(');
  const { open, close } = markers ?? { open: undefined, close: -1 };
  if (open === undefined || close === -1) {
    const doc = parseTextBlock(source);
    return { state: EditorState.create({ doc, selection: TextSelection.atStart(doc) }) };
  }
  const text = source.slice(0, open) + ANCHOR + source.slice(open + 1, close) + HEAD + source.slice(close + 1);
  const parsed = parseTextBlock(text);
  const at: Record<string, number> = {};
  parsed.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of [ANCHOR, HEAD]) {
      const index = node.text?.indexOf(mark) ?? -1;
      if (index >= 0) at[mark] = pos + index;
    }
  });
  const tr = EditorState.create({ doc: parsed }).tr;
  tr.delete(at[HEAD], at[HEAD] + 1).delete(at[ANCHOR], at[ANCHOR] + 1);
  const selection = TextSelection.create(tr.doc, at[ANCHOR], at[HEAD] - 1);
  return { state: EditorState.create({ doc: tr.doc, selection }) };
}

const cache = createMarkdownCache();

/** The Markdown of a state's document. */
export function markdownOf(state: { doc: EditorState['doc'] }): string {
  return serializeTextBlock(state.doc, cache);
}

/** Runs a command on marked Markdown and returns the Markdown after it, or null when it doesn't apply. */
export function applyTo(source: string, command: Command): string | null {
  const { state } = marked(source);
  let after: EditorState | null = null;
  const ran = command(state, (tr) => {
    after = state.apply(tr);
  });
  return ran && after ? markdownOf(after) : null;
}

export interface TestEditor {
  readonly editor: Editor;
  readonly host: TestHost;
  readonly root: HTMLElement;
  markdown(): string;
  destroy(): void;
}

/** A mounted text editor over marked Markdown. */
export function mountEditor(source: string, host: TestHost = testHost()): TestEditor {
  const { state } = marked(source);
  const root = document.body.appendChild(document.createElement('div'));
  const editor = createBlockEditor(root, state.doc, { kind: 'text', block: 'b1', host });
  editor.commands.setTextSelection({ from: state.selection.anchor, to: state.selection.head });
  return {
    editor,
    host,
    root,
    markdown: () => markdownOf(editor.state),
    destroy() {
      editor.destroy();
      root.remove();
    },
  };
}

/** Types text one character at a time, as the browser reports it: through handleTextInput, else inserted. */
export function typeInto(editor: Editor, text: string): void {
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handle) => handle(view, from, to, char, () => view.state.tr));
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}
