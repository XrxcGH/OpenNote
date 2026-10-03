// Automatic changes (ARCHITECTURE.md sections 8.3 and 10.3; owner: WP4). Markdown shortcuts and AutoCorrect change
// text the person typed. Each change is its own undo step, so one Ctrl+Z leaves the typed characters.
//
// The typed character goes in first, as typing. The change follows in its own transaction marked with
// META_AUTO_CHANGE, which the sync sends as its own step. Backspace right after the change, before anything else
// happens, reverts it the same way.
import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Step } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import { META_AUTO_CHANGE } from '../meta';
import type { AutoChangeMeta } from '../meta';
import { markdownShortcutsPlugin } from './markdownShortcuts';

/** Marks a transaction as an automatic change of `from` to `to` into `text`: its own undo step. */
export function markAutoChange(tr: Transaction, change: AutoChangeMeta): Transaction {
  return tr.setMeta(META_AUTO_CHANGE, { from: change.from, to: change.to, text: change.text });
}

interface Revertible {
  steps: readonly Step[];
  docs: readonly PMNode[];
}

const REVERT = 'opennote.autoChangeRevert';
export const autoChangeKey = new PluginKey<Revertible | null>('opennoteAutoChange');

/** The last automatic change after `tr`: its own steps, or nothing once anything else changes. */
function remember(tr: Transaction, value: Revertible | null): Revertible | null {
  if (tr.getMeta(META_AUTO_CHANGE) && tr.docChanged && !tr.getMeta(REVERT)) {
    return { steps: tr.steps.slice(), docs: tr.docs.slice() };
  }
  return tr.docChanged || tr.selectionSet ? null : value;
}

/** Remembers the last automatic change until anything else changes the document or the selection. */
function revertPlugin(): Plugin<Revertible | null> {
  return new Plugin<Revertible | null>({ key: autoChangeKey, state: { init: () => null, apply: remember } });
}

/** Undoes the last automatic change, if nothing happened since. Returns whether it did. */
export function revertAutoChange(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const last = autoChangeKey.getState(state);
  if (!last) return false;
  if (dispatch) {
    const tr = state.tr;
    for (let index = last.steps.length - 1; index >= 0; index -= 1) {
      tr.step(last.steps[index].invert(last.docs[index]));
    }
    const at = tr.mapping.map(state.selection.from);
    dispatch(markAutoChange(tr, { from: at, to: at, text: '' }).setMeta(REVERT, true).scrollIntoView());
  }
  return true;
}

/** Types `text` over `from` to `to` as ordinary typing, then dispatches `change` of the result, if any, on its own. */
export function typeThenChange(
  view: EditorView,
  typed: { from: number; to: number; text: string },
  change: (state: EditorState) => { tr: Transaction; meta: AutoChangeMeta } | null,
): void {
  view.dispatch(view.state.tr.insertText(typed.text, typed.from, typed.to));
  const made = change(view.state);
  if (made) view.dispatch(markAutoChange(made.tr, made.meta).scrollIntoView());
}

/** Whether automatic changes may run at the position: not in code, links, or math, and not while composing. */
export function canAutoChange(view: EditorView, pos: number): boolean {
  if (view.composing) return false;
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
  const marks = [...$pos.marks(), ...(view.state.storedMarks ?? [])];
  return !marks.some((mark) => mark.type.name === 'link' || mark.type.spec.code);
}

export function autoChangeExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'opennoteAutoChange',
      // Before the list and callout keys, so Backspace right after "- " reverts the list rather than lifting it.
      priority: 1000,
      addProseMirrorPlugins: () => [revertPlugin(), markdownShortcutsPlugin(host)],
      addKeyboardShortcuts() {
        const editor: Editor = this.editor;
        return {
          Backspace: () => editor.state.selection.empty && revertAutoChange(editor.state, editor.view.dispatch),
        };
      },
    }),
  ];
}
