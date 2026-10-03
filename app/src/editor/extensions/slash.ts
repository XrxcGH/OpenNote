// The slash menu's trigger (ARCHITECTURE.md section 17.1; owner: WP4). Typing "/" at the start of a line opens a
// session that follows the filter typed after it. The menu itself is the page's: the editor announces the session
// with SLASH_MENU_EVENT, and the page attaches its listbox to it.
//
// While a menu is attached, Up, Down, Enter, Tab, and Escape go to it, and the editor keeps focus. The trigger
// never opens in links, code, math, or table cells, while composing, or when the setting or flag is off.
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ancestorDepth } from '../commands/command';
import type { EditorHost } from '../host';

export { SLASH_MENU_EVENT } from '../commands/state';
import { SLASH_MENU_EVENT } from '../commands/state';

/** What the page's menu does with a session's keys and changes. */
export interface SlashMenuUi {
  update(): void;
  /** Handles Up, Down, Enter, Tab, and Escape. Returns whether it used the key. */
  key(event: KeyboardEvent): boolean;
  close(): void;
}

/** One open slash menu: the "/" at `from` and the filter typed after it. */
export interface SlashSession {
  readonly view: EditorView;
  readonly from: number;
  readonly query: string;
  /** Where the "/" is on screen, for placing the menu. */
  rect(): { left: number; top: number; bottom: number };
  /** The page's menu attaches here when it opens. */
  attach(ui: SlashMenuUi): void;
  /** Deletes the "/" and the filter, before the chosen item runs. */
  remove(): void;
  /** Closes the session, keeping the text. */
  close(): void;
}

interface SlashState {
  from: number;
  query: string;
}

export const slashKey = new PluginKey<SlashState | null>('opennoteSlash');
const OPEN = 'opennote.slashOpen';
const CLOSE = 'opennote.slashClose';

/** Whether "/" may open the menu at the selection. */
export function slashAllowed(state: EditorState, host: EditorHost): boolean {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code || $from.parentOffset !== 0) return false;
  if (!host.settings().slashMenu || !host.flag('page.slashMenu')) return false;
  if (ancestorDepth($from, ['tableCell', 'tableHeader', 'calloutTitle']) >= 0) return false;
  return !$from.marks().some((mark) => mark.type.name === 'link' || mark.type.spec.code);
}

/** The session's state after `tr`: the "/" mapped, and the filter between it and the caret, or closed. */
function follow(tr: Transaction, value: SlashState | null): SlashState | null {
  const opened = tr.getMeta(OPEN) as number | undefined;
  if (opened !== undefined) return { from: opened, query: '' };
  if (!value || tr.getMeta(CLOSE)) return null;
  const from = tr.mapping.map(value.from);
  const { $head, empty } = tr.selection;
  if (!empty || $head.pos <= from || $head.parent !== tr.doc.resolve(from).parent) return null;
  const typed = tr.doc.textBetween(from, $head.pos, '\n', '\n');
  if (!typed.startsWith('/') || typed.includes('\n') || typed.length > 40 || /\s\s/.test(typed)) return null;
  return { from, query: typed.slice(1) };
}

function makeSession(view: EditorView, state: SlashState, owner: { ui: SlashMenuUi | null }): SlashSession {
  return {
    view,
    from: state.from,
    query: state.query,
    rect() {
      try {
        const at = view.coordsAtPos(state.from);
        return { left: at.left, top: at.top, bottom: at.bottom };
      } catch {
        const box = view.dom.getBoundingClientRect();
        return { left: box.left, top: box.top, bottom: box.top };
      }
    },
    attach: (ui) => void (owner.ui = ui),
    remove() {
      const current = slashKey.getState(view.state);
      if (!current) return;
      const to = view.state.selection.head;
      view.dispatch(view.state.tr.delete(current.from, to).setMeta(CLOSE, true));
    },
    close: () => view.dispatch(view.state.tr.setMeta(CLOSE, true)),
  };
}

function slashPlugin(host: EditorHost): Plugin<SlashState | null> {
  const owner: { ui: SlashMenuUi | null } = { ui: null };
  return new Plugin<SlashState | null>({
    key: slashKey,
    state: { init: () => null, apply: follow },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== '/' || view.composing || !slashAllowed(view.state, host) || from !== to) return false;
        view.dispatch(view.state.tr.insertText('/', from, to).setMeta(OPEN, from));
        return true;
      },
      handleKeyDown(_view, event) {
        return owner.ui !== null && owner.ui.key(event);
      },
    },
    view: (view) => ({
      update(_view, previous) {
        const before = slashKey.getState(previous);
        const now = slashKey.getState(view.state);
        if (before === now) return;
        if (!now) {
          owner.ui?.close();
          owner.ui = null;
          return;
        }
        if (before) {
          // The page's menu reads the filter as it attaches, so a session it hasn't reached yet waits.
          owner.ui?.update();
          return;
        }
        const session = makeSession(view, now, owner);
        view.dom.dispatchEvent(new CustomEvent(SLASH_MENU_EVENT, { bubbles: true, detail: session }));
      },
      destroy: () => owner.ui?.close(),
    }),
  });
}

/** The open session in a view, for the page's menu to read the current filter. */
export function slashSessionOf(view: EditorView): { from: number; query: string } | null {
  return slashKey.getState(view.state) ?? null;
}

export function slashExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'opennoteSlash',
      // Before the editor's own Enter, Tab, and Escape, so the open menu gets them first.
      priority: 1100,
      addProseMirrorPlugins: () => [slashPlugin(host)],
    }),
  ];
}
