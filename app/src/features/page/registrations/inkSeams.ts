// The seams the ink view needs from the rest of the page that load only on use: reading and tidying handwriting through
// the on-device recognizer (Phase 12), and editing typed text where the pen is (the typed-notes editor). The ink view
// cannot import either, so registrations/ink.ts hands it these as lazy calls. Nothing here loads at start-up.
import type { Editor } from '@tiptap/core';
import type { InkRecognition, InkStroke, TidyOperation, TidyPlan } from '../../../services/intel';
import { shownPool } from '../pool/shown';
import { shownMedia } from '../images/shown';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Reads the handwriting in these strokes. Null when the person said not now or reading failed (which is reported). */
export async function recognize(strokes: InkStroke[], ask = true): Promise<InkRecognition | null> {
  const api = await intel();
  await api.loadIntel();
  if (ask ? !(await api.askToTurnOn('handwriting')) : !api.isOn('handwriting')) return null;
  try {
    return await (await api.intelClient()).recognizeInk(strokes, { kind: 'writing' });
  } catch (error) {
    api.reportProblem(error, 'handwriting');
    return null;
  }
}

/** Asks once to turn handwriting reading on, so the question is not put while the pen is writing. */
export async function ensureHandwriting(): Promise<boolean> {
  return (await intel()).askToTurnOn('handwriting');
}

/** The moves that tidy handwriting that was already read. Null when it could not be planned. */
export async function tidy(
  strokes: InkStroke[],
  recognition: InkRecognition,
  operation: TidyOperation,
): Promise<TidyPlan | null> {
  const api = await intel();
  if (!(await api.askToTurnOn('handwriting'))) return null;
  try {
    return await (await api.intelClient()).tidyInk(strokes, recognition, operation);
  } catch (error) {
    api.reportProblem(error, 'handwriting');
    return null;
  }
}

function editorOf(block: string): Editor | null {
  const pool = shownPool.get();
  return pool?.editor(block) ?? pool?.mount(block, null, 'target') ?? null;
}

/** The text block under a client point, with the editor position there. */
export function hit(
  clientX: number,
  clientY: number,
): { block: string; pos: number; top: number; bottom: number } | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const holder = element.closest<HTMLElement>('[data-block-id]');
    const block = holder?.dataset.blockId;
    if (!block || holder.dataset.ink !== undefined) continue;
    const editor = editorOf(block);
    const found = editor?.view.posAtCoords({ left: clientX, top: clientY });
    if (editor && found) {
      const line = editor.view.coordsAtPos(found.pos);
      return { block, pos: found.pos, top: line.top, bottom: line.bottom };
    }
  }
  return null;
}

const WORD = /[^\s]/;

/** The whole words between two positions of one paragraph, with a trailing space, and their text. */
export function words(block: string, a: number, b: number): { from: number; to: number; text: string } | null {
  const editor = editorOf(block);
  if (!editor) return null;
  const doc = editor.state.doc;
  const [low, high] = a <= b ? [a, b] : [b, a];
  const $low = doc.resolve(Math.min(low, doc.content.size));
  const $high = doc.resolve(Math.min(high, doc.content.size));
  if (!$low.parent.isTextblock || $low.parent !== $high.parent) return null;
  const text = $low.parent.textContent;
  const start = $low.start();
  let from = $low.parentOffset;
  let to = $high.parentOffset;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  while (to < text.length && WORD.test(text[to])) to++;
  if (to <= from) return null;
  const word = text.slice(from, to);
  // The space after the words goes with them, so no double space is left behind.
  if (text[to] === ' ') to++;
  else if (from > 0 && text[from - 1] === ' ') from--;
  return { from: start + from, to: start + to, text: word };
}

/** The paragraph at a position: where its text starts, its text, and the caret's offset in it when the caret is there. */
export function paragraph(block: string, pos: number): { start: number; text: string; caret: number | null } | null {
  const editor = editorOf(block);
  if (!editor) return null;
  const doc = editor.state.doc;
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  if (!$pos.parent.isTextblock) return null;
  const start = $pos.start();
  const { empty, head } = editor.state.selection;
  const inside = empty && editor.isFocused && head >= start && head <= $pos.end();
  return { start, text: $pos.parent.textContent, caret: inside ? head - start : null };
}

type Run = { kind: 'text'; text: string } | { kind: 'math'; latex: string; display: boolean };
const NEWLINE = '\n';

/** The typed text the person has selected in the active text block, with its math, and where it sits. */
export function selection(): {
  block: string;
  from: number;
  to: number;
  runs: Run[];
  start: { x: number; y: number };
  rect: { x: number; y: number; w: number; h: number };
  fontSize: number;
} | null {
  const active = shownPool.get()?.active();
  if (!active) return null;
  const { editor, block } = active;
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const runs: Run[] = [];
  const text = (value: string) => {
    const last = runs[runs.length - 1];
    if (last?.kind === 'text') last.text += value;
    else runs.push({ kind: 'text', text: value });
  };
  let parent: unknown = null;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (parent !== null) text(NEWLINE);
      parent = node;
      return true;
    }
    if (node.isText) {
      const start = Math.max(from, pos) - pos;
      const end = Math.min(to, pos + node.nodeSize) - pos;
      text((node.text ?? '').slice(start, end));
    } else if (node.type.name === 'mathInline')
      runs.push({ kind: 'math', latex: String(node.attrs.source ?? ''), display: false });
    else if (node.type.name === 'mathBlock')
      runs.push({ kind: 'math', latex: String(node.attrs.source ?? ''), display: true });
    else if (node.type.name === 'hardBreak') text(NEWLINE);
    return true;
  });
  const coords = editor.view.coordsAtPos(from);
  const box = (editor.view.dom.closest('[data-block-id]') ?? editor.view.dom).getBoundingClientRect();
  const fontSize = Number.parseFloat(getComputedStyle(editor.view.dom).fontSize) || 16;
  return {
    block,
    from,
    to,
    runs,
    start: { x: coords.left, y: coords.top },
    rect: { x: box.left, y: box.top, w: box.width, h: box.height },
    fontSize,
  };
}

export function remove(block: string, from: number, to: number): boolean {
  return editorOf(block)?.chain().deleteRange({ from, to }).run() ?? false;
}

export function insert(block: string, pos: number, text: string): boolean {
  return editorOf(block)?.chain().insertContentAt(pos, text).run() ?? false;
}

export function split(block: string, pos: number): boolean {
  return editorOf(block)?.chain().setTextSelection(pos).splitBlock().run() ?? false;
}

export function select(block: string, from: number, to: number): boolean {
  return editorOf(block)?.chain().focus().setTextSelection({ from, to }).run() ?? false;
}

/** Undoes the last step once the editor has handed its text to the page, so the undo takes that edit and no other. */
export async function undoText(block: string): Promise<void> {
  const editor = editorOf(block);
  // The text block's code loads only when a text edit is undone, so it stays out of the start-up bundle.
  const { syncOf } = await import('../blocks/textBlock');
  const sync = editor ? syncOf(editor) : null;
  await sync?.flush('command');
  await shownMedia.get()?.sync.undo();
}
