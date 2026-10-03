// Code blocks (ARCHITECTURE.md sections 10.2 and 14; owner: WP6). The node keeps the schema's definition and adds a
// view with a language button, the keys of section 22.4, and the "editor.code" scope while the caret is in code.
import { Extension, InputRule } from '@tiptap/core';
import type { Editor, Extensions, NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import {
  arrowDownLeave,
  cleanLanguage,
  codeBlockAt,
  indentCode,
  leaveCode,
  newlineKeepIndent,
  setCodeLanguage,
  tripleEnterLeave,
} from '../commands/code';
import type { Command } from '../commands/code';
import styles from '../highlight/code.module.css';
import { CODE_LANGUAGES, languageName } from '../highlight/languages';
import { languagePicker } from '../highlight/picker';
import type { EditorHost } from '../host';
import { CodeBlock } from '../schema/nodes';

/** Opens the language picker for the code block at `pos`, and sets the language chosen. */
export function pickCodeLanguage(view: EditorView, pos: number, anchor: HTMLElement, host: EditorHost): void {
  const language = (view.state.doc.nodeAt(pos)?.attrs.language as string | null) ?? null;
  const picker = languagePicker();
  if (picker) return picker({ view, pos, anchor, language });
  const items = [
    { id: '', label: t('code.language.plain'), kind: 'radio' as const, checked: !language },
    ...CODE_LANGUAGES.map((one) => ({
      id: one.id,
      label: one.name,
      kind: 'radio' as const,
      checked: one.id === language,
    })),
  ];
  void host.openMenu({ label: t('code.language.picker'), items, anchor }).then((chosen) => {
    if (chosen === null || view.isDestroyed) return;
    applyLanguage(view, pos, chosen || null, host);
  });
}

/** Sets a code block's language and says so. */
export function applyLanguage(
  view: EditorView,
  pos: number,
  language: string | null,
  host: Pick<EditorHost, 'announce'>,
): boolean {
  const done = setCodeLanguage(pos, language)(view.state, view.dispatch);
  if (done)
    host.announce(t('code.language.set', { name: languageName(cleanLanguage(language)) ?? t('code.language.plain') }));
  view.focus();
  return done;
}

const buttonLabel = (language: string | null) => languageName(language) ?? t('code.language.plain');

function codeBlockView(host: EditorHost): NodeViewRenderer {
  return ({ node, getPos, editor }) => {
    let current = node;
    const dom = document.createElement('pre');
    dom.className = styles.block;
    const button = dom.appendChild(document.createElement('button'));
    button.type = 'button';
    button.setAttribute('contenteditable', 'false');
    button.className = styles.language;
    button.dataset.codeLanguage = '';
    const code = dom.appendChild(document.createElement('code'));
    code.setAttribute('spellcheck', 'false');
    const show = (shown: PMNode) => {
      const language = (shown.attrs.language as string | null) ?? null;
      const name = buttonLabel(language);
      button.textContent = name;
      button.setAttribute('aria-label', t('code.language.button', { name }));
      code.className = language ? `language-${language}` : '';
    };
    show(node);
    // A press keeps the caret where it is; the click opens the picker.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const pos = getPos();
      if (typeof pos === 'number') pickCodeLanguage(editor.view, pos, button, host);
    });
    return {
      dom,
      contentDOM: code,
      update(next) {
        if (next.type !== current.type) return false;
        if (next.attrs.language !== current.attrs.language) show(next);
        current = next;
        return true;
      },
      stopEvent: (event) => button.contains(event.target as Node),
      ignoreMutation: (mutation) =>
        mutation.type === 'attributes' || (mutation.type !== 'selection' && button.contains(mutation.target)),
    };
  };
}

const scopeKey = new PluginKey('opennote.codeScope');

/** The "editor.code" key scope while the selection is in code, so Ctrl+Enter leaves the block there. */
function scopePlugin(): Plugin {
  return new Plugin({
    key: scopeKey,
    props: {
      attributes: (state: EditorState): Record<string, string> =>
        codeBlockAt(state) ? { 'data-scope': 'editor.code' } : {},
    },
  });
}

/** Three backticks and a language name at a line start make a code block in that language. */
const FENCE = /^```([A-Za-z0-9_+#.-]{1,32})?[\s]$/;

function key(editor: Editor, command: Command): () => boolean {
  return () => command(editor.state, editor.view.dispatch, editor.view);
}

export function codeBlockExtensions(host: EditorHost): Extensions {
  const Code = CodeBlock.extend({
    addNodeView: () => codeBlockView(host),
    addInputRules() {
      const type = this.type;
      return [
        new InputRule({
          find: FENCE,
          handler: ({ state, range, match }) => {
            if (!host.settings().markdownShortcuts) return null;
            const $start = state.doc.resolve(range.from);
            if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), type)) return null;
            state.tr.delete(range.from, range.to).setBlockType(range.from, range.from, type, {
              language: cleanLanguage(match[1] ?? null),
            });
          },
        }),
      ];
    },
  });
  const Keys = Extension.create({
    name: 'opennoteCodeKeys',
    // Ahead of the text editor's own Tab and Enter handling, which applies outside code.
    priority: 1200,
    addKeyboardShortcuts() {
      const { editor } = this;
      return {
        Tab: key(editor, indentCode(1)),
        'Shift-Tab': key(editor, indentCode(-1)),
        Enter: () => key(editor, tripleEnterLeave)() || key(editor, newlineKeepIndent)(),
        ArrowDown: key(editor, arrowDownLeave),
        'Mod-Enter': key(editor, leaveCode),
      };
    },
    addProseMirrorPlugins: () => [scopePlugin()],
  });
  return [Code, Keys];
}
