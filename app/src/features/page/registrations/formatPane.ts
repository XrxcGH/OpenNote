// The Format pane's commands (text program, Beta 11; text DESIGN.md 5.3), behind text.formatPane: Ctrl+D opens the
// pane on Text, the Paragraph launcher opens it on Paragraph, and Reveal formatting says where each format at the
// caret comes from. The pane loads when a command runs, so start-up stays light.
import { defineCommand } from '../../../commands/registry';
import { commandContext } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui/toast';
import { targetEditor } from '../formattingBar/target';
import type { TabId } from '../formatPane/fields';

const FLAG = 'text.formatPane';

async function openOn(tab: TabId): Promise<void> {
  const store = await import('../styles/store');
  const notebook = store.shownNotebook();
  if (!notebook) {
    showToast({ message: t('textStyles.noNotebook') });
    return;
  }
  try {
    await store.loadStyles(notebook);
  } catch {
    showToast({ message: t('textStyles.loadFailed'), tone: 'danger' });
    return;
  }
  const { openFormatPane } = await import('../formatPane/mount');
  openFormatPane({ notebook, tab, fonts: commandContext('commandBar').platform.fonts });
}

function openCommand(id: CommandId, title: MessageKey, tab: TabId): void {
  commands.register(
    defineCommand({
      id,
      title,
      category: 'format',
      keywords: 'editor.keywords.block',
      flag: FLAG,
      run: () => openOn(tab),
    }),
  );
}

openCommand('format.fontDialog', 'textPane.commands.fontDialog', 'text');
openCommand('format.paragraphDialog', 'textPane.commands.paragraphDialog', 'paragraph');

commands.register(
  defineCommand({
    id: 'format.reveal',
    title: 'textPane.commands.reveal',
    category: 'format',
    keywords: 'editor.keywords.block',
    flag: FLAG,
    run: async () => {
      const editor = targetEditor();
      if (!editor) {
        showToast({ message: t('textPane.noEditor') });
        return;
      }
      const [store, reveal, keys] = await Promise.all([
        import('../styles/store'),
        import('../formatPane/reveal'),
        import('../../../editor/extensions/keys'),
      ]);
      const words = reveal.revealText(reveal.revealFormatting(editor.state, store.shownContext(store.shownNotebook())));
      keys.hostOf(editor)?.announce(words);
    },
  }),
);
