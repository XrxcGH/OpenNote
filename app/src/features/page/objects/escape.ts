// Escape from text selects the block (ARCHITECTURE.md section 11.2; owner WP3). ProseMirror cancels every Escape
// keydown, so the page can't tell Escape that closed a popup from Escape that leaves the text. This keymap runs
// last of the editor's keymaps instead: a slash menu, a link popover, or any extension that binds Escape first
// keeps it.
import { Extension } from '@tiptap/core';
import { editorExtensions } from '../../../editor/extensions/kit';

let registered = false;

/** Registers the Escape keymap once, for text and table editors. */
export function registerEscapeToObjects(): void {
  if (registered) return;
  registered = true;
  editorExtensions.register({
    id: 'page.escapeToObjects',
    order: 1000,
    kinds: ['text', 'table'],
    create: (host) =>
      Extension.create({
        name: 'pageEscapeToObjects',
        priority: 1,
        addKeyboardShortcuts: () => ({
          Escape: ({ editor }) => {
            const block = editor.view.dom.getAttribute('data-block');
            if (!block) return false;
            host.selectBlocks([block], 'escape');
            return true;
          },
        }),
      }),
  });
}
