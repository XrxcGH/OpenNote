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
import { TextMarks } from '../../../core/audio';
import type { StampEntry, TextMarksData } from '../../../core/audio';
import { META_REMOTE } from '../../../editor/meta';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { appendToNextBatch } from '../sync/shown';
import { dataOf, recordingBlocks } from './blocks';
import { stampNow } from './controller';
import { clockNs } from './format';
import { addStampSource, openFor, playAtCapture } from './playback';

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

/** Plays the recording from the moment the text at `offset` of the block was written. */
export async function playFromText(block: string, offset?: number): Promise<boolean> {
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

/** Alt+click on text plays the recording from the moment it was written. */
export function installTapToHear(): void {
  if (clicks || typeof document === 'undefined') return;
  const onClick = (event: MouseEvent) => {
    if (!event.altKey || event.button !== 0 || !isEnabled('audio.stamps')) return;
    const block = (event.target as Element | null)?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    if (!block) return;
    // The press before the click has already put the caret in the word, so the caret says which word it was.
    setTimeout(() => {
      const at = caret();
      void playFromText(block, at?.block === block ? at.offset : undefined);
    }, 0);
  };
  document.addEventListener('click', onClick, true);
  clicks = () => document.removeEventListener('click', onClick, true);
}

/** Stops everything this module watches. */
export function stopStamps(): void {
  detach?.();
  detach = null;
  clicks?.();
  clicks = null;
}
