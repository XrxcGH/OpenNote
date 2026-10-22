// \alpha-style autocompletion in page text. Typing a backslash and the start of a LaTeX name (`\al`) opens a small
// list of matching symbols. Up and Down choose, Enter or Tab puts the symbol in, and Escape closes the list. A
// complete name followed by a space or a closing mark (`\alpha `) turns into its symbol at once. Undo brings the
// typed name back. Nothing happens in code, in links, or while composing.
import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { completions, symbolFor } from '../symbols/data';
import type { MathSymbol } from '../symbols/data';
import { pushRecent } from '../symbols/recent';
import styles from './editor.module.css';

/** The `\name` being typed at the caret: where the backslash is, where the caret is, and the name so far. */
export interface SymbolToken {
  from: number;
  to: number;
  prefix: string;
}

const TOKEN = /(?:^|[^A-Za-z0-9\\])\\([A-Za-z][A-Za-z0-9]*)$/;
const CLOSERS = /^[\s.,;:)\]]$/;

export function tokenAt(state: EditorState): SymbolToken | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code || mark.type.name === 'link')) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 48), $from.parentOffset, undefined, '\0');
  const found = TOKEN.exec(before);
  if (!found) return null;
  const prefix = found[1] ?? '';
  return { from: $from.pos - prefix.length - 1, to: $from.pos, prefix };
}

interface Open {
  token: SymbolToken;
  items: { command: string; symbol: MathSymbol }[];
  index: number;
}
interface State {
  open: Open | null;
  /** The backslash position of a list the person closed with Escape, so it stays closed for that name. */
  dismissed: number | null;
}

const key = new PluginKey<State>('opennoteSymbols');
const MOVE = 'opennote.symbols.move';
const DISMISS = 'opennote.symbols.dismiss';

function follow(state: EditorState, previous: State, moved: number, dismiss: boolean): State {
  const token = tokenAt(state);
  if (!token) return { open: null, dismissed: null };
  const dismissed = dismiss ? token.from : previous.dismissed;
  if (dismissed === token.from) return { open: null, dismissed };
  const items = completions(token.prefix);
  if (items.length === 0) return { open: null, dismissed: null };
  const same = previous.open?.token.prefix === token.prefix && previous.open.token.from === token.from;
  const index = same ? ((((previous.open?.index ?? 0) + moved) % items.length) + items.length) % items.length : 0;
  return { open: { token, items, index }, dismissed: null };
}

function put(view: EditorView, token: SymbolToken, symbol: MathSymbol, after = ''): void {
  view.dispatch(view.state.tr.insertText(symbol.char + after, token.from, token.to).scrollIntoView());
  pushRecent(symbol.char);
}

function listFor(view: EditorView): { root: HTMLElement; show(open: Open | null): void; destroy(): void } {
  const root = document.createElement('div');
  root.className = styles.symbolList ?? '';
  root.setAttribute('role', 'listbox');
  root.setAttribute('aria-label', t('study.symbols.suggestions'));
  root.id = `symbol-list-${Math.random().toString(36).slice(2, 8)}`;
  root.hidden = true;
  document.body.appendChild(root);
  let shownKey = '';
  return {
    root,
    show(open) {
      if (!open) {
        root.hidden = true;
        shownKey = '';
        return;
      }
      const stamp = `${open.token.from}:${open.token.prefix}:${open.index}`;
      if (stamp === shownKey) return;
      const sameList = shownKey.startsWith(`${open.token.from}:${open.token.prefix}:`);
      shownKey = stamp;
      if (!sameList || root.childElementCount !== open.items.length) {
        root.replaceChildren(
          ...open.items.map((item, at) => {
            const row = document.createElement('div');
            row.setAttribute('role', 'option');
            row.id = `${root.id}-${at}`;
            row.className = styles.symbolRow ?? '';
            row.addEventListener('mousedown', (event) => {
              // Keep focus in the editor, then put the symbol in.
              event.preventDefault();
              const current = key.getState(view.state)?.open;
              if (current) put(view, current.token, item.symbol);
            });
            const glyph = document.createElement('span');
            glyph.className = styles.symbolGlyph ?? '';
            glyph.textContent = item.symbol.char;
            glyph.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.textContent = `\\${item.command}`;
            const label = document.createElement('span');
            label.className = styles.symbolName ?? '';
            label.textContent = item.symbol.name;
            row.append(glyph, name, label);
            return row;
          }),
        );
      }
      Array.from(root.children).forEach((row, at) => row.setAttribute('aria-selected', String(at === open.index)));
      try {
        const at = view.coordsAtPos(open.token.to);
        root.style.left = `${Math.round(at.left)}px`;
        root.style.top = `${Math.round(at.bottom + 4)}px`;
      } catch {
        // A position that cannot be drawn leaves the list where it was.
      }
      root.hidden = false;
      const chosen = open.items[open.index];
      if (chosen) announce(t('study.symbols.choice', { name: chosen.symbol.name, command: `\\${chosen.command}` }));
    },
    destroy: () => root.remove(),
  };
}

function symbolsPlugin(): Plugin<State> {
  return new Plugin<State>({
    key,
    state: {
      init: () => ({ open: null, dismissed: null }),
      apply(tr, value, _old, next) {
        if (!tr.docChanged && !tr.selectionSet && !tr.getMeta(MOVE) && !tr.getMeta(DISMISS)) return value;
        const moved = (tr.getMeta(MOVE) as number | undefined) ?? 0;
        return follow(next, value, moved, tr.getMeta(DISMISS) === true);
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (view.composing || from !== to || text.length !== 1 || !CLOSERS.test(text)) return false;
        const token = tokenAt(view.state);
        const symbol = token ? symbolFor(token.prefix) : undefined;
        if (!token || !symbol || token.to !== from) return false;
        put(view, token, symbol, text);
        return true;
      },
      handleKeyDown(view, event) {
        const open = key.getState(view.state)?.open;
        if (!open || view.composing) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          view.dispatch(view.state.tr.setMeta(MOVE, event.key === 'ArrowDown' ? 1 : -1));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const chosen = open.items[open.index];
          if (!chosen) return false;
          put(view, open.token, chosen.symbol);
          return true;
        }
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(DISMISS, true));
          return true;
        }
        return false;
      },
    },
    view(view) {
      const list = listFor(view);
      return {
        update: () => list.show(key.getState(view.state)?.open ?? null),
        destroy: () => list.destroy(),
      };
    },
  });
}

export function symbolsExtension() {
  return Extension.create({
    name: 'opennoteSymbols',
    // Before the editor's own Enter, Tab, and Escape, so an open list gets them first.
    priority: 1050,
    addProseMirrorPlugins: () => [symbolsPlugin()],
  });
}

export { key as symbolsKey };
