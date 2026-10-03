// Where a notebook's custom vocabulary is kept: a text file in this device's store, one for each notebook and one for
// all of them. A list that can't be read is an empty list, which changes nothing.
import { intelExt } from '../runtime';
import { vocabularyFile } from './list';

/** The vocabulary of a notebook as plain text, or an empty string. */
export async function loadVocabulary(notebookId: string | null): Promise<string> {
  try {
    return (await (await intelExt()).get(vocabularyFile(notebookId))) ?? '';
  } catch {
    return '';
  }
}

/** Saves the vocabulary of a notebook. Rejects when the device store can't write. */
export async function saveVocabulary(notebookId: string | null, text: string): Promise<void> {
  await (await intelExt()).put(vocabularyFile(notebookId), text);
}
