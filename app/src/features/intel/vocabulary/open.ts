// Opens the vocabulary editor for the notebook the person is in, or for all notebooks when none is open.
import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import { openVocabularyEditor } from './VocabularyDialog';

export async function editVocabularyForCurrentNotebook(): Promise<void> {
  const where = getLocation();
  const notebookId = where.view === 'workspace' ? where.notebookId : null;
  let name: string | null = null;
  if (notebookId) {
    try {
      name = (await commandContext('menu').notes.get(notebookId))?.title ?? null;
    } catch {
      name = null;
    }
  }
  await openVocabularyEditor(notebookId, name);
}
