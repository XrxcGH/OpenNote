// After the person fixes a word in a transcript, offers to add it to the notebook's custom vocabulary, so the
// transcriber spells it that way next time. The offer is one quiet toast with an Add button. Nothing is added
// without that click, and an offer that can't be made is simply not shown.
import { isEnabled } from '../../../../app/flags';
import { getLocation } from '../../../../app/location';
import { fixedWords } from './model';

/** Offers the term the person fixed, from a line's text before and after. Resolves true when an offer was shown. */
export async function offerFixedTerm(before: string, after: string): Promise<boolean> {
  if (!isEnabled('intel.vocabulary')) return false;
  const words = fixedWords(before, after);
  if (!words) return false;
  const where = getLocation();
  const notebookId = where.view === 'workspace' ? where.notebookId : null;
  try {
    const api = await import('../../../intel').then((module) => module.loadApi());
    return await api.offerVocabularyTerm(notebookId, words.original, words.fixed);
  } catch {
    return false;
  }
}
