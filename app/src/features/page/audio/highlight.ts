// The moving highlight (Phase 9): while a recording plays, what was written at that moment is tinted. Every block
// gets its whole wrapper marked, which covers static text. A block with an editor open also gets the words
// themselves, through the browser's highlight API.
import type { Editor } from '@tiptap/core';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { playbackUi } from './playback';

const NAME = 'audio-now';
let marked = new Set<HTMLElement>();

interface Highlights {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}
const registry = (): Highlights | null => (globalThis.CSS as unknown as { highlights?: Highlights }).highlights ?? null;
const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

function rangeOf(editor: Editor, from: number, to: number): Range | null {
  try {
    const start = editor.view.domAtPos(from);
    const end = editor.view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function paint(): void {
  const { highlight } = playbackUi.get();
  const layer = shownLayer.get();
  const pool = shownPool.get();
  const next = new Set<HTMLElement>();
  const ranges: Range[] = [];
  for (const entry of highlight) {
    if (entry.target.type === 'item') {
      const snap = layer?.view(entry.target.id)?.element;
      if (snap) next.add(snap);
      continue;
    }
    if (entry.target.type !== 'text') continue;
    const { block, from, to } = entry.target;
    const element = layer?.view(block)?.element;
    if (element) next.add(element);
    const editor = pool?.editor(block);
    const range = editor ? rangeOf(editor, from, to) : null;
    if (range) ranges.push(range);
  }
  for (const element of marked) if (!next.has(element)) element.removeAttribute('data-audio-now');
  for (const element of next) element.setAttribute('data-audio-now', 'true');
  marked = next;
  const highlights = registry();
  if (!highlights || !HighlightClass) return;
  if (ranges.length > 0) highlights.set(NAME, new HighlightClass(...ranges));
  else highlights.delete(NAME);
}

/** Starts painting what plays. Returns a function that stops and clears it. */
export function followPlayback(): () => void {
  const stop = playbackUi.subscribe(paint);
  return () => {
    stop();
    for (const element of marked) element.removeAttribute('data-audio-now');
    marked = new Set();
    registry()?.delete(NAME);
  };
}
