// What the transcript commands do (the palette and the keys). Each picks its recording or transcript from the page:
// the recording that is open for listening, or else the first one. This module loads when one of them runs.
import type { RecordingEntry } from '../../../../core/audio';
import type { BlockJson } from '../../../../services/pages/types';
import { t } from '../../../../strings/t';
import { showToast } from '../../../../ui';
import { dataOf as recordingData, recordingBlocks } from '../blocks';
import { playbackUi } from '../playback';
import { shownLayer } from '../../mount';
import { addFromText, makeTranscript, quoteLines } from './actions';
import { dataOf, lineSelection, transcriptBlocks } from './store';

/** The recording a command is about: the one open for listening, or else the first on the page. */
function target(): { holder: BlockJson; entry: RecordingEntry } | null {
  const open = playbackUi.get().block;
  const blocks = recordingBlocks();
  const holder = blocks.find((block) => block.id === open) ?? blocks[0];
  const entry = holder && recordingData(holder)?.entry;
  return holder && entry ? { holder, entry } : null;
}

export async function make(): Promise<void> {
  const found = target();
  if (!found) return void showToast({ message: t('audioMore.transcript.noRecording') });
  await makeTranscript(found.holder, found.entry);
}

export async function add(): Promise<void> {
  const found = target();
  if (!found) return void showToast({ message: t('audioMore.transcript.noRecording') });
  await addFromText(found.holder, found.entry);
}

export async function recap(): Promise<void> {
  if (recordingBlocks().length === 0 && transcriptBlocks().length === 0) {
    return void showToast({ message: t('audioMore.transcript.noRecording') });
  }
  await (await import('./dialogs')).openRecap();
}

/** Copies the lines ticked in a transcript into the notes at the caret. */
export async function quote(): Promise<void> {
  const { block, ids, includeSpeaker } = lineSelection.get();
  const held = block && shownLayer.get()?.block(block);
  const data = held && dataOf(held);
  if (!data || ids.size === 0) return void showToast({ message: t('audioMore.transcript.nothingSelected') });
  await quoteLines(data, ids, includeSpeaker);
}
