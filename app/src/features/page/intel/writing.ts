// Writing tools on the selected text (Phase 12): Proofread, Rewrite, Shorten, Make a list, and Tidy structure. The
// suggestion, with its changes marked, is made and shown in features/intel; this side reads the selection from the
// editor that has it and, when the person accepts, replaces just that text, with one Undo. Loads on first use.
import { parseTextBlock } from '../../../editor/markdown';
import { META_COMMAND } from '../../../editor/meta';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { shownQueue } from '../sync/shown';
import { selection } from './selection';

type Tool = 'proofread' | 'rewrite' | 'shorten' | 'list' | 'tidy';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Makes a suggestion for the selected text and, if the person accepts it, puts it in the selection's place. */
export async function runWritingTool(tool: Tool): Promise<void> {
  const found = selection();
  if (!found) {
    showToast({ message: t('intelPlus.writing.noSelection') });
    return;
  }
  const { editor, from, to } = found;
  const before = editor.state.doc.textBetween(from, to, '\n');
  const { suggestWriting } = await intel();
  const result = await suggestWriting(tool, before);
  if (!result) return;
  // The page may have changed while the person read the suggestion. If the words are not the same, nothing is replaced.
  if (editor.state.doc.textBetween(from, to, '\n') !== before) return;
  if (result.markdown) {
    editor.chain().focus().insertContentAt({ from, to }, parseTextBlock(result.text).content.toJSON()).run();
  } else {
    editor.view.dispatch(editor.state.tr.insertText(result.text, from, to).setMeta(META_COMMAND, true));
    editor.view.focus();
  }
  showToast({
    message: t('intelPlus.writing.accepted'),
    action: { label: t('intelPlus.writing.undo'), run: () => void shownQueue.get()?.undo() },
  });
}
