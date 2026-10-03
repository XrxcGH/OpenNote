// The transcripts of the shown page: finding a recording's transcript block, making one, and saving a change. A change
// is a `patchBlock` step that carries the new data and the new readable copy, so search indexes what the transcript
// says now, and one undo takes the change back.
import type { BlockId, BlockJson } from '../../../../services/pages/types';
import { createStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { insertExtBlock } from '../blocks';
import { shownLayer } from '../../mount';
import { shownQueue } from '../../sync/shown';
import { markdownOf, TRANSCRIPT_TYPE } from './model';
import type { SpeakerWord, TranscriptData } from './model';

/** The lines the person ticked in a transcript, so the key and the button copy the same ones. */
export const lineSelection = createStore<{ block: BlockId | null; ids: ReadonlySet<string>; includeSpeaker: boolean }>(
  { block: null, ids: new Set(), includeSpeaker: true },
  'transcript line selection',
);

export const speakerWord: SpeakerWord = (n) => t('audioMore.transcript.speaker', { n });

/** Whether a value read from a block looks like a transcript. */
function isTranscript(value: unknown): value is TranscriptData {
  const data = value as Partial<TranscriptData> | null;
  return (
    !!data &&
    typeof data.recording === 'string' &&
    Array.isArray(data.lines) &&
    typeof data.speakers === 'object' &&
    data.speakers !== null
  );
}

/** The transcript a block holds, with the members an older copy lacks filled in. */
export function dataOf(block: BlockJson): TranscriptData | null {
  const raw = block.data as unknown;
  if (!isTranscript(raw)) return null;
  return { ...raw, summary: raw.summary ?? '', chapters: raw.chapters ?? [], language: raw.language ?? null };
}

/** The transcript blocks of the shown page. */
export const transcriptBlocks = (): BlockJson[] =>
  (shownLayer.get()?.blocks() ?? []).filter((block) => block.type === TRANSCRIPT_TYPE);

/** The block that holds a recording's transcript. */
export const transcriptOf = (recording: string): BlockJson | null =>
  transcriptBlocks().find((block) => dataOf(block)?.recording === recording) ?? null;

const fallbackOf = (data: TranscriptData) => ({ markdown: markdownOf(data, speakerWord) });

/** Adds a transcript block after the recording's block. */
export function addTranscript(data: TranscriptData, after: BlockId): Promise<BlockId> {
  return insertExtBlock(
    { type: TRANSCRIPT_TYPE, data: data as unknown as Record<string, unknown>, fallback: fallbackOf(data) },
    after,
  );
}

/** Names that a speaker no longer has are sent as null, because a merge patch keeps what it isn't told to drop. */
function patchOf(previous: TranscriptData, next: TranscriptData): Record<string, unknown> {
  const gone = Object.fromEntries(Object.keys(previous.speakers).map((key) => [key, null]));
  return { ...next, speakers: { ...gone, ...next.speakers } };
}

/** Saves a change to a transcript. */
export async function saveTranscript(block: BlockId, previous: TranscriptData, next: TranscriptData): Promise<void> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!queue || !layer) throw new Error('No page is shown.');
  const fallback = fallbackOf(next);
  await queue.send({ edits: [{ edit: 'patchBlock', block, data: patchOf(previous, next), fallback }] });
  const held = layer.block(block);
  if (held) {
    layer.upsert({
      ...held,
      data: next as unknown as BlockJson['data'],
      fallback,
      modified: new Date().toISOString(),
    });
  }
}

/** The names the person gave speakers before, newest first, for suggesting them in a later recording. */
const NAMES_KEY = 'opennote.transcripts.speakerNames';
const MAX_NAMES = 30;

export function savedSpeakerNames(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberSpeakerName(name: string): void {
  const clean = name.trim();
  if (!clean) return;
  try {
    const names = [clean, ...savedSpeakerNames().filter((saved) => saved !== clean)].slice(0, MAX_NAMES);
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // Without storage the name is simply not suggested later.
  }
}
