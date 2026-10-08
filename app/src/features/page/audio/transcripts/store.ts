// The transcripts of the shown page. The core can't edit the data of a block of a type it doesn't know, but it edits
// and keeps the page's view, so a transcript is kept there, under `transcripts`, by the recording it belongs to. Its
// block only says where it sits, as the recording's block does. The block's fallback text is the transcript as plain
// text: it is what search indexes. A fallback can't change either, so a change that should reach search puts a new
// block, with the new text, where the old one was.
import { newId } from '../../../../editor/ids';
import type { BlockId, BlockJson, Edit, NewBlock, OpenPage } from '../../../../services/pages/types';
import { createStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { shownLayer } from '../../mount';
import { shownQueue } from '../../sync/shown';
import { insertExtBlock } from '../blocks';
import { markdownOf } from './model';
import type { SpeakerWord, TranscriptData } from './model';
import { TRANSCRIPT_TYPE } from './moment';

/** The transcripts of the shown page, by recording. */
export const transcripts = createStore<ReadonlyMap<string, TranscriptData>>(new Map(), 'transcripts');

/** The lines the person ticked in a transcript, so the key and the button copy the same ones. */
export const lineSelection = createStore<{ block: BlockId | null; ids: ReadonlySet<string>; includeSpeaker: boolean }>(
  { block: null, ids: new Set(), includeSpeaker: true },
  'transcript line selection',
);

export const speakerWord: SpeakerWord = (n) => t('audioMore.transcript.speaker', { n });

/** Whether a value read from a page view looks like a transcript, with the members an older copy lacks filled in. */
function normalize(value: unknown): TranscriptData | null {
  const data = value as Partial<TranscriptData> | null;
  if (!data || typeof data.recording !== 'string' || !Array.isArray(data.lines)) return null;
  // A name set to null was removed by a merge patch.
  const names = Object.entries(data.speakers ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return {
    recording: data.recording,
    language: data.language ?? null,
    summary: data.summary ?? '',
    lines: data.lines,
    speakers: Object.fromEntries(names),
    chapters: data.chapters ?? [],
    source: data.source ?? 'imported',
  };
}

/** The transcripts a page view holds. */
export function transcriptsOf(view: unknown): TranscriptData[] {
  const held = (view as { transcripts?: Record<string, unknown> } | null | undefined)?.transcripts;
  return held && typeof held === 'object' ? Object.values(held).flatMap((value) => normalize(value) ?? []) : [];
}

let adopted: { page: string; stop: () => void } | null = null;

/** Takes the page's transcripts, and follows its changes, such as an undo, until another page is adopted. */
export function adoptTranscripts(page: OpenPage): void {
  if (adopted?.page === page.id) return;
  adopted?.stop();
  transcripts.set(new Map(transcriptsOf(page.initial.view).map((data) => [data.recording, data])));
  const stop = page.onFrame((frame) => {
    const changed = transcriptsOf(frame.page?.view);
    if (changed.length > 0) hold(changed);
  });
  adopted = { page: page.id, stop };
}

function hold(changed: readonly TranscriptData[]): void {
  transcripts.set(
    (held) => new Map([...held, ...changed.map((data): [string, TranscriptData] => [data.recording, data])]),
  );
}

export const transcriptData = (recording: string): TranscriptData | null => transcripts.get().get(recording) ?? null;

export const recordingOf = (block: BlockJson): string | null =>
  typeof block.data['recording'] === 'string' ? block.data['recording'] : null;

/** The transcript a block stands for. */
export function dataOf(block: BlockJson): TranscriptData | null {
  const recording = recordingOf(block);
  return recording ? transcriptData(recording) : null;
}

/** The transcript blocks of the shown page. */
export const transcriptBlocks = (): BlockJson[] =>
  (shownLayer.get()?.blocks() ?? []).filter((block) => block.type === TRANSCRIPT_TYPE);

/** The block that holds a recording's transcript. */
export const transcriptOf = (recording: string): BlockJson | null =>
  transcriptBlocks().find((block) => recordingOf(block) === recording) ?? null;

const fallbackOf = (data: TranscriptData) => ({ markdown: markdownOf(data, speakerWord) });

/** Names that a speaker no longer has are sent as null, because a merge patch keeps what it isn't told to drop. */
function viewEdit(previous: TranscriptData | null, next: TranscriptData): Edit {
  const gone = Object.fromEntries(Object.keys(previous?.speakers ?? {}).map((key) => [key, null]));
  const value = { ...next, speakers: { ...gone, ...next.speakers } };
  return { edit: 'setPage', view: { transcripts: { [next.recording]: value } } };
}

/** Adds a transcript after the recording's block. */
export async function addTranscript(data: TranscriptData, after: BlockId): Promise<BlockId> {
  const spec = { type: TRANSCRIPT_TYPE, data: { recording: data.recording }, fallback: fallbackOf(data) };
  const id = await insertExtBlock(spec, after, [viewEdit(null, data)]);
  hold([data]);
  return id;
}

/**
 * Saves a change to a transcript. With `refresh`, the block is put again with the new text for search, which ends an
 * edit in progress, so the changes of editing words wait until the person is done.
 */
export async function saveTranscript(
  block: BlockId,
  previous: TranscriptData,
  next: TranscriptData,
  refresh = true,
): Promise<void> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!queue || !layer) throw new Error('No page is shown.');
  hold([next]);
  const edits: Edit[] = [viewEdit(previous, next)];
  const old = layer.block(block);
  if (!refresh || !old) {
    await queue.send({ edits });
    return;
  }
  const id = newId();
  const fallback = fallbackOf(next);
  const made = {
    id,
    type: TRANSCRIPT_TYPE,
    data: { recording: next.recording },
    fallback,
    ...(old.frame ? { frame: old.frame } : {}),
  };
  const ack = await queue.send({
    edits: [
      { edit: 'insertBlock', block: made as unknown as NewBlock, before: block },
      { edit: 'deleteBlocks', blocks: [block] },
      ...edits,
    ],
  });
  const now = new Date().toISOString();
  layer.upsert({ ...made, order: ack.orderKeys[id] ?? old.order, created: now, modified: now } as unknown as BlockJson);
  layer.remove(block);
  const picked = lineSelection.get();
  if (picked.block === block) lineSelection.set({ ...picked, block: id });
}

/** Puts the block again with the transcript's text as it is now, so search finds the words the person just edited. */
export async function refreshText(block: BlockId): Promise<void> {
  const held = shownLayer.get()?.block(block);
  const data = held && dataOf(held);
  if (data) await saveTranscript(block, data, data);
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
