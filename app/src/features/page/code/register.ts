// The code commands (ARCHITECTURE.md section 14; owner: WP6): Set code language and Leave code block. They apply
// only with the caret in code, so they register from this chunk in idle time after start-up. Ctrl+Enter also works
// before then, because code blocks handle it themselves.
import type { Editor } from '@tiptap/core';
import { commands } from '../../../registries';
import { pageCommandDef } from '../keys';
import { shownPool } from '../pool/shown';
import { lateRefines } from '../tables/refines';
import { leaveCodeBlock, openCodeLanguage } from './commands';

/** The active editor when its selection is inside one code block. */
function codeEditor(): Editor | null {
  const editor = shownPool.get()?.active()?.editor ?? null;
  const selection = editor?.state.selection;
  if (!selection || selection.$from.parent.type.name !== 'codeBlock') return null;
  return selection.$from.sameParent(selection.$to) ? editor : null;
}

commands.register(
  lateRefines(
    pageCommandDef({
      id: 'code.setLanguage',
      title: 'code.commands.setLanguage',
      keywords: 'code.commands.keywords',
      category: 'format',
      when: () => codeEditor() !== null,
      run() {
        const editor = codeEditor();
        if (editor) openCodeLanguage(editor);
      },
    }),
  ),
);

commands.register(
  lateRefines(
    pageCommandDef({
      id: 'code.exit',
      title: 'code.commands.exit',
      keywords: 'code.commands.keywords',
      category: 'editing',
      when: () => codeEditor() !== null,
      run() {
        const editor = codeEditor();
        if (editor) leaveCodeBlock(editor);
      },
    }),
  ),
);
