// The editor keymap (owner: WP4): the keys ProseMirror owns inside a text box. Formatting and block keys are page
// commands, which Phase 2's dispatcher runs before the editor sees them.
//
// What stays here are the fixed keys. Shift+Enter types a line break. Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z go to the
// page's undo, because text fields keep them from the dispatcher and the core owns undo.
//
// It also keeps the page's EditorHost in the editor's storage, so commands reach announcements and menus.
import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { executeCommand } from '../../commands/registry';
import type { EditorHost } from '../host';

const NAME = 'opennoteHost';

interface HostStorage {
  host: EditorHost | null;
}

/** The host of the page the editor belongs to. */
export function hostOf(editor: Editor): EditorHost | null {
  const storage = (editor.storage as unknown as Record<string, HostStorage | undefined>)[NAME];
  return storage?.host ?? null;
}

/** Inserts a line break, or a newline inside code. */
function lineBreak(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  if ($from.parent.type.spec.code) return editor.commands.insertContent('\n');
  const hardBreak = state.schema.nodes.hardBreak;
  const marks = state.storedMarks ?? $from.marks();
  const tr = state.tr.replaceSelectionWith(hardBreak.create(), false);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(state.selection.to))));
  tr.setStoredMarks(marks);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function pageHistory(editor: Editor, id: 'page.undo' | 'page.redo'): boolean {
  if (editor.view.composing) return false;
  void executeCommand(id, undefined, 'keyboard');
  return true;
}

/** The page's text menu, with formatting and spelling, instead of the plain edit menu. */
function textMenuPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('opennoteTextMenu'),
    props: { attributes: { 'data-app-menu': 'page.text' } },
  });
}

export function keysExtensions(host: EditorHost): Extensions {
  return [
    Extension.create<Record<string, never>, HostStorage>({
      name: NAME,
      addStorage: () => ({ host }),
      addProseMirrorPlugins: () => [textMenuPlugin()],
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => lineBreak(this.editor),
          'Mod-z': () => pageHistory(this.editor, 'page.undo'),
          'Mod-y': () => pageHistory(this.editor, 'page.redo'),
          'Mod-Shift-z': () => pageHistory(this.editor, 'page.redo'),
        };
      },
    }),
  ];
}
