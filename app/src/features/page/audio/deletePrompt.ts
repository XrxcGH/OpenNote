// What deleting a recording block asks first (Beta 8 full walk). The block holds a recording the person made, so
// deleting it names the recording and its length, and the toast after it names it too and offers Undo. The audio
// files stay on disk when the block goes, so Undo brings the whole recording back.
import type { DeletePrompt } from '../blocks/types';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { activeNs, nameOf, recordingIdOf } from './entry';
import { entryOf } from './entries';
import { lengthNs } from './format';

export function recordingDeletePrompt(blocks: readonly BlockJson[]): DeletePrompt | null {
  const entries = blocks.flatMap((block) => entryOf(recordingIdOf(block)) ?? []);
  // A block with no entry holds nothing to lose.
  if (entries.length === 0) return null;
  const length = lengthNs(entries.reduce((sum, entry) => sum + activeNs(entry), 0));
  const [only] = entries;
  const name = entries.length === 1 && only ? (nameOf(only) ?? t('audio.delete.unnamed')) : '';
  const many = entries.length > 1;
  const params = { count: entries.length, name, length };
  return {
    title: many ? t('audio.delete.titleMany', params) : t('audio.delete.title'),
    body: many ? t('audio.delete.bodyMany', params) : t('audio.delete.body', params),
    confirmLabel: t(many ? 'audio.delete.actionMany' : 'audio.delete.action'),
    done: many ? t('audio.delete.doneMany', params) : t('audio.delete.done', params),
  };
}
