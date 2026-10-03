// Tab and Shift+Tab (ARCHITECTURE.md section 22.4; owner: WP4). They stay inside the editor. A list item indents
// or outdents, a paragraph at its start becomes a bulleted list item, and elsewhere Tab types a tab character.
// Code blocks and table cells keep their own Tab keys, so these give way there.
import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { t } from '../../strings/t';
import { runCommand } from '../commands/command';
import { indent, outdent, tabResult } from '../commands/tab';
import type { EditorHost } from '../host';

function announceResult(host: EditorHost, editor: Editor, result: ReturnType<typeof tabResult>): void {
  if (result === 'bulleted') host.announce(t('editor.tab.bulleted'));
  else if (result === 'numbered') host.announce(t('editor.announce.block', { name: t('editor.commands.orderedList') }));
  else if (result === 'outdented' && editor.state.selection.$from.depth === 1) host.announce(t('editor.tab.paragraph'));
}

function tab(host: EditorHost, editor: Editor, shift: boolean): boolean {
  const result = tabResult(editor.state, shift);
  if (result === 'tab') {
    // A tab character is typing, not a command.
    editor.view.dispatch(editor.state.tr.insertText('\t').scrollIntoView());
    return true;
  }
  const command = shift ? outdent() : indent();
  if (!command(editor.state)) return false;
  runCommand(editor, command, { focus: false });
  announceResult(host, editor, result);
  return true;
}

export function tabKeysExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'opennoteTabKeys',
      addKeyboardShortcuts() {
        return {
          Tab: () => tab(host, this.editor, false),
          'Shift-Tab': () => tab(host, this.editor, true),
        };
      },
    }),
  ];
}
