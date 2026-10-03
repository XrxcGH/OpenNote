// Time stamps on typed text (Phase 9). While a recording runs, every change to a text block is marked with the
// recording and the moment it was typed (core/audio/stamps.ts), and the marks move with later edits. They ride in
// the same step as the text change, in the block's `data.marks`, so one undo takes back both. Alt+click on a word,
// or the "Play from the caret" command, plays the recording from the moment that word was written.
//
// The marks are positions in the block's document, counted as the editor counts. This module watches the editor
// that has the caret, from outside, so it needs nothing from the editor kit.
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { isEnabled } from '../../../app/flags';
import { extrasOf, strokeEntries, TapRecognizer, tapPlays, TextMarks } from '../../../core/audio';
import type { StampEntry, StrokeTime, TextMarksData } from '../../../core/audio';
import { META_REMOTE } from '../../../editor/meta';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { shownStrokes } from '../seams/inkStrokes';
import { pageSelection } from '../seams/selectionStore';
import { appendToNextBatch } from '../sync/shown';
import { dataOf, recordingBlocks } from './blocks';
import { recordingEntries } from './entries';
import { stampNow } from './controller';
import { clockNs } from './format';
import { addStampSource, openFor, playAtCapture } from './playback';
import { playbackOpen } from './state';

/** The marks of the shown page's text blocks, by block. A page switch starts a new set. */
let marksByBlock = new Map<string, TextMarks>();
let forPage: string | null = null;

function ownPage(): void {
  const page = shownOpenPage.get()?.id ?? null;
  if (page !== forPage) {
    marksByBlock = new Map();
    forPage = page;
  }
}

function readMarks(block: string): TextMarks | null {
  const data = shownLayer.get()?.block(block)?.data.marks as TextMarksData | undefined;
  return data && Array.isArray(data.marks) && Array.isArray(data.recordings) ? new TextMarks(data) : null;
}

/** A block's marks. With `create`, a block that has none gets an empty set. */
export function marksOf(block: string, create = false): TextMarks | null {
  ownPage();
  let marks = marksByBlock.get(block) ?? readMarks(block);
  if (!marks && create) marks = new TextMarks();
  if (marks) marksByBlock.set(block, marks);
  return marks;
}

function onTransaction(block: string, transaction: Transaction): void {
  if (!transaction.docChanged || !isEnabled('audio.stamps')) return;
  const remote = transaction.getMeta(META_REMOTE) === true;
  const stamp = remote ? undefined : (stampNow() ?? undefined);
  const marks = marksOf(block, stamp !== undefined);
  if (!marks) return;
  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) =>
      marks.edit(oldStart, oldEnd - oldStart, newEnd - newStart, stamp),
    );
  }
  appendToNextBatch(block, [{ edit: 'patchBlock', block, data: { marks: marks.toData() } }]);
}

let detach: (() => void) | null = null;

function follow(editor: Editor, block: string): () => void {
  const handler = ({ transaction }: { transaction: Transaction }) => onTransaction(block, transaction);
  editor.on('transaction', handler);
  return () => void editor.off('transaction', handler);
}

/** Follows the editor that has the caret, and the next one when the caret moves to another block. */
export function watchEditors(): () => void {
  const pool = shownPool.get();
  if (!pool) return () => undefined;
  const attach = () => {
    detach?.();
    const active = pool.active();
    detach = active ? follow(active.editor, active.block) : null;
  };
  attach();
  const stop = pool.onActiveChange(attach);
  return () => {
    stop();
    detach?.();
    detach = null;
  };
}

/** Every mark of the page's text, as stamps for the index that finds a moment from a word and a word from a moment. */
export function textEntries(): StampEntry[] {
  const entries: StampEntry[] = [];
  for (const block of shownLayer.get()?.blocks() ?? []) {
    const marks = marksOf(block.id);
    for (const mark of marks?.marks ?? []) {
      const recording = marks?.recordingOf(mark);
      if (recording === undefined) continue;
      entries.push({
        recording,
        startNs: mark.startNs,
        endNs: mark.endNs,
        target: { type: 'text', block: block.id, from: mark.from, to: mark.to },
      });
    }
  }
  return entries;
}
addStampSource(textEntries);

/** The shown page's strokes as the stamp index reads them: start and length in milliseconds. */
function strokeTimes(ids?: readonly string[]): StrokeTime[] {
  return shownStrokes(ids).map((stroke) => ({
    id: stroke.id,
    startMs: stroke.startTime,
    durationMs: stroke.points.at(-1)?.time ?? 0,
  }));
}

/** Every stroke drawn while one of the page's recordings ran. A stroke keeps its start time, so it needs no marks. */
export function inkEntries(): StampEntry[] {
  return strokeEntries([...recordingEntries.get().values()], strokeTimes());
}
addStampSource(inkEntries);

/** Plays the recording from the moment the first of these strokes (the selected ones by default) was drawn. */
export async function playFromInk(ids: readonly string[] = pageSelection.get().strokes): Promise<boolean> {
  const strokes = strokeTimes(ids).sort((a, b) => a.startMs - b.startMs);
  const entry = strokeEntries([...recordingEntries.get().values()], strokes)[0];
  const holder = entry && recordingBlocks().find((candidate) => dataOf(candidate)?.entry.id === entry.recording);
  const page = shownOpenPage.get()?.id;
  if (!entry || !holder || !page || !(await openFor(holder, page))) return false;
  await playAtCapture(entry.startNs);
  const started = dataOf(holder)?.entry.startedNs ?? 0;
  announce(t('audio.announce.playingFrom', { time: clockNs(entry.startNs - started) }));
  return true;
}

/** The screen snaps of the page's recordings as stamps, so a snap lights up while its moment plays. */
export function snapEntries(): StampEntry[] {
  return [...recordingEntries.get().values()].flatMap((entry) =>
    (extrasOf(entry).snaps ?? []).map((one) => ({
      recording: entry.id,
      startNs: one.captureNs,
      endNs: one.captureNs,
      target: { type: 'item' as const, id: one.block },
    })),
  );
}
addStampSource(snapEntries);

/** The recording and moment a block (a screen snap) was added at, if it was added while recording. */
function snapOf(block: string): { recording: string; captureNs: number } | null {
  for (const entry of recordingEntries.get().values()) {
    const one = extrasOf(entry).snaps?.find((snap) => snap.block === block);
    if (one) return { recording: entry.id, captureNs: one.captureNs };
  }
  return null;
}

/** Plays the recording from the moment a screen snap was taken. */
async function playFromSnap(block: string): Promise<boolean> {
  const snap = snapOf(block);
  const holder = snap && recordingBlocks().find((candidate) => dataOf(candidate)?.entry.id === snap.recording);
  const page = shownOpenPage.get()?.id;
  if (!snap || !holder || !page || !(await openFor(holder, page))) return false;
  await playAtCapture(snap.captureNs);
  const started = dataOf(holder)?.entry.startedNs ?? 0;
  announce(t('audio.announce.playingFrom', { time: clockNs(snap.captureNs - started) }));
  return true;
}

/** Plays the recording from the moment the text at `offset` of the block was written. */
export async function playFromText(block: string, offset?: number): Promise<boolean> {
  if (snapOf(block)) return playFromSnap(block);
  const marks = marksOf(block);
  const first = marks?.marks[0];
  if (!marks || !first) {
    announce(t('audio.announce.nothingStamped'));
    return false;
  }
  const at = offset === undefined || !marks.markAt(offset) ? first.from : offset;
  const time = marks.timeAt(at);
  const holder = time && recordingBlocks().find((candidate) => dataOf(candidate)?.entry.id === time.recording);
  const page = shownOpenPage.get()?.id;
  if (!time || !holder || !page || !(await openFor(holder, page))) return false;
  await playAtCapture(time.captureNs);
  const started = dataOf(holder)?.entry.startedNs ?? 0;
  announce(t('audio.announce.playingFrom', { time: clockNs(time.captureNs - started) }));
  return true;
}

/** The block and caret position of the editor that has the caret. */
function caret(): { block: string; offset: number } | null {
  const active = shownPool.get()?.active();
  return active ? { block: active.block, offset: active.editor.state.selection.head } : null;
}

export async function playFromCaret(): Promise<boolean> {
  const at = caret();
  return at ? playFromText(at.block, at.offset) : false;
}

let clicks: (() => void) | null = null;

/** The block that holds an event's target, if the target is in one. */
const blockOf = (event: Event): string | undefined =>
  (event.target as Element | null)?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;

/**
 * Plays from the word the caret has just landed in, if that word was written during a recording. A tap on a word
 * with no time stamp is only a tap, so it says nothing.
 */
function playFromTap(block: string): void {
  // The press before the tap has already put the caret in the word, so the caret says which word it was.
  setTimeout(() => {
    const at = caret();
    if (snapOf(block) || (at?.block === block && marksOf(block)?.markAt(at.offset))) {
      void playFromText(block, at?.block === block ? at.offset : undefined);
    }
  }, 0);
}

/**
 * Alt+click, and a tap of a pen or a finger, on text plays the recording from the moment it was written. A tap
 * plays when a recording is open for listening, and a double tap plays at any time, so a single tap can still place
 * the caret to type.
 */
export function installTapToHear(): void {
  if (clicks || typeof document === 'undefined') return;
  const onClick = (event: MouseEvent) => {
    if (!event.altKey || event.button !== 0 || !isEnabled('audio.stamps')) return;
    const block = blockOf(event);
    if (!block) return;
    // The press before the click has already put the caret in the word, so the caret says which word it was.
    setTimeout(() => {
      const at = caret();
      void playFromText(block, at?.block === block ? at.offset : undefined);
    }, 0);
  };
  const taps = new TapRecognizer();
  const sample = (event: PointerEvent) => ({
    id: event.pointerId,
    type: event.pointerType,
    x: event.clientX,
    y: event.clientY,
    at: event.timeStamp,
  });
  const onDown = (event: PointerEvent) => taps.press(sample(event));
  const onUp = (event: PointerEvent) => {
    const kind = taps.release(sample(event));
    if (!kind || !isEnabled('audio.stamps') || !tapPlays(kind, playbackOpen.get())) return;
    const block = blockOf(event);
    if (block) playFromTap(block);
  };
  const onCancel = () => taps.cancel();
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onCancel, true);
  clicks = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
  };
}

/** Stops everything this module watches. */
export function stopStamps(): void {
  detach?.();
  detach = null;
  clicks?.();
  clicks = null;
}
