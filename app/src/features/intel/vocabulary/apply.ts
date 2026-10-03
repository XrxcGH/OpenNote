// Using the vocabulary on a transcript (Phase 12): the offer to add a term after the person fixes a word, and the fix
// of a whole transcript with a preview of every change and one Undo. The transcript's own screen calls these from its
// word editing and from its menu. Nothing is changed until the person applies it.
import type { VocabularyChange } from '../../../services/intel';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { isOn } from '../choices';
import { intelClient, intelExt } from '../runtime';
import { addTerm } from './list';
import { loadVocabulary, saveVocabulary } from './store';

/** Adds the offered term to the notebook's list and says so. A failed save is shown. */
async function addOffered(notebookId: string | null, offer: { term: string; heardAs: string }): Promise<void> {
  try {
    await saveVocabulary(notebookId, addTerm(await loadVocabulary(notebookId), offer.term, offer.heardAs));
    showToast({ message: t('intelPlus.vocabulary.added', { term: offer.term }) });
  } catch {
    showToast({ message: t('intelPlus.vocabulary.saveFailed'), tone: 'danger' });
  }
}

/** The term worth offering after a fix, or null when there is none or the question can't be asked. */
async function termToOffer(notebookId: string | null, original: string, fixed: string) {
  try {
    const list = await loadVocabulary(notebookId);
    return await (await intelClient()).vocabularyOffer(list, original, fixed);
  } catch {
    return null;
  }
}

/**
 * After the person fixed `original` to `fixed` in a transcript, offers to add the term. Does nothing when
 * transcription is off, when the term is listed or ordinary, or when the call fails: an offer is never worth an error.
 * Resolves true when an offer was shown.
 */
export async function offerVocabularyTerm(
  notebookId: string | null,
  original: string,
  fixed: string,
): Promise<boolean> {
  if (!isOn('transcription')) return false;
  const offer = await termToOffer(notebookId, original, fixed);
  if (!offer) return false;
  showToast({
    message: t('intelPlus.vocabulary.offerMessage', { term: offer.term }),
    action: { label: t('intelPlus.vocabulary.offerAdd'), run: () => addOffered(notebookId, offer) },
  });
  return true;
}

export interface VocabularyPreview {
  /** The text with every change made. */
  text: string;
  changes: readonly VocabularyChange[];
}

/** What the vocabulary would change in `text`, without changing anything. Null when there is no list. */
export async function previewVocabulary(notebookId: string | null, text: string): Promise<VocabularyPreview | null> {
  const list = await loadVocabulary(notebookId);
  if (!list.trim()) return null;
  try {
    const fixed = await (await intelExt()).correctVocabulary(list, text);
    return { text: fixed.text, changes: fixed.changes };
  } catch {
    return null;
  }
}

/**
 * Shows the preview and, when the person applies it, calls `write` with the fixed text and offers Undo, which calls
 * `write` with the original. Resolves true when the changes were applied.
 */
export async function fixWithVocabulary(
  notebookId: string | null,
  text: string,
  write: (text: string) => void,
): Promise<boolean> {
  const preview = await previewVocabulary(notebookId, text);
  if (!preview || preview.changes.length === 0) {
    showToast({ message: t('intelPlus.vocabulary.previewNone') });
    return false;
  }
  const { openPreview } = await import('./PreviewDialog');
  if (!(await openPreview(preview.changes))) return false;
  write(preview.text);
  showToast({
    message: t('intelPlus.vocabulary.applied', { count: preview.changes.length }),
    action: { label: t('intelPlus.vocabulary.undo'), run: () => write(text) },
  });
  return true;
}
