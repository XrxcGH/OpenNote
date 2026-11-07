// Character formatting (owner: text:editor-commands): toggled marks, colors, text sizes, and clearing. Each function
// is a ProseMirror command, so the page's commands, the formatting bar, and tests share one body. Run formats beyond
// these live in runFormat.ts; paragraph formats in paragraph.ts.
import type { Mark } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { HighlightColor, TextSizeName } from '../schema/specs';
import { isTextSize } from '../schema/constants';
import { fromChange } from './command';
import type { Change, Command } from './command';
import { viaFormatTarget } from './formatTarget';
import { CONTENT_MARKS, addMark, removeMark } from './runFormat';
import { BODY_POINTS, nudgeSize, pointsOf, sizeText, stepSize } from './sizes';
import { isMarkActive, markAttrs } from './state';

export { isMarkActive, markAttrs } from './state';

export type ToggledMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'subscript' | 'superscript';

/** Text sizes from small to extra large. Normal text has no mark, so it sits between small and large. */
const SIZE_STEPS: readonly (TextSizeName | null)[] = ['small', null, 'large', 'xlarge'];

/** Bold, italic, and the other marks without attributes: on unless the whole selection has it already. Bold takes a
 * weight mark off, so Ctrl+B on Semibold text gives bold (R-MRK-27). */
export function toggleMark(name: ToggledMark): Command {
  return viaFormatTarget({ format: name, toggle: true }, (state, dispatch) => {
    const type = state.schema.marks[name];
    const active = isMarkActive(state, name);
    return fromChange((tr) => (active ? removeMark(tr, type) : addMark(tr, type, null)))(state, dispatch);
  });
}

/** Highlight in a color; null is Honey. The same color again takes the highlight off. */
export function toggleHighlight(color: HighlightColor | null = null): Command {
  return viaFormatTarget({ format: 'highlight', color, toggle: true }, (state, dispatch) => {
    const type = state.schema.marks.highlight;
    const active = isMarkActive(state, 'highlight', { color });
    return fromChange((tr) => (active ? removeMark(tr, type) : addMark(tr, type, { color })))(state, dispatch);
  });
}

/** Sets the highlight color, or takes the highlight off with `'none'`. */
export function setHighlight(color: HighlightColor | null | 'none'): Command {
  const change = fromChange((tr) => {
    const type = tr.doc.type.schema.marks.highlight;
    return color === 'none' ? removeMark(tr, type) : addMark(tr, type, { color });
  });
  return viaFormatTarget({ format: 'highlight', color, toggle: false }, change);
}

/** A pen name or `#rrggbb`; null takes the color off. */
export function setTextColor(color: string | null): Command {
  const change = fromChange((tr) => {
    const type = tr.doc.type.schema.marks.textColor;
    return color === null ? removeMark(tr, type) : addMark(tr, type, { color });
  });
  return viaFormatTarget({ format: 'textColor', color }, change);
}

/** A text size: a version 1 name or points as text (`10.5`); null is normal size. */
export function setTextSize(size: string | null): Command {
  const change = fromChange((tr) => {
    const type = tr.doc.type.schema.marks.textSize;
    if (size === null) return removeMark(tr, type);
    return isTextSize(size) && addMark(tr, type, { size });
  });
  return viaFormatTarget({ format: 'textSize', size }, change);
}

/** The size of the selection's first character, or null for normal text. Points are text, such as `10.5`. */
export function currentTextSize(state: EditorState): TextSizeName | null {
  return (markAttrs(state, 'textSize')?.size as TextSizeName | undefined) ?? null;
}

/** Moves the size of every run in the selection on its own, or the size typing at the caret takes. */
function resize(tr: Transaction, next: (points: number) => number): boolean {
  const type = tr.doc.type.schema.marks.textSize;
  const sizeOf = (marks: readonly Mark[]) =>
    pointsOf((marks.find((mark) => mark.type === type)?.attrs.size as string | undefined) ?? null, BODY_POINTS);
  const { selection } = tr;
  if (selection.empty) {
    const marks = tr.storedMarks ?? selection.$from.marks();
    const from = sizeOf(marks);
    if (from === null || next(from) === from || !selection.$from.parent.type.allowsMarkType(type)) return false;
    tr.setStoredMarks(type.create({ size: sizeText(next(from)) }).addToSet(type.removeFromSet(marks)));
    return true;
  }
  const runs: { from: number; to: number; size: string }[] = [];
  for (const range of selection.ranges) {
    tr.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos, parent) => {
      if (!node.isText || !parent?.type.allowsMarkType(type)) return true;
      const at = sizeOf(node.marks);
      if (at === null || next(at) === at) return false;
      const from = Math.max(pos, range.$from.pos);
      const to = Math.min(pos + node.nodeSize, range.$to.pos);
      if (from < to) runs.push({ from, to, size: sizeText(next(at)) });
      return false;
    });
  }
  for (const run of runs) tr.addMark(run.from, run.to, type.create({ size: run.size }));
  return runs.length > 0;
}

/** Word's grow and shrink (Ctrl+Shift+> and <): every run moves to the next size on the preset list. */
export function growFont(direction: 1 | -1): Command {
  const change = fromChange((tr) => resize(tr, (points) => stepSize(points, direction)));
  return viaFormatTarget({ format: 'textSizeStep', direction, by: 'preset' }, change);
}

/** Plus or minus one point (Word Ctrl+] and Ctrl+[), clamped to 1 and 1638. */
export function nudgeFont(direction: 1 | -1): Command {
  const change = fromChange((tr) => resize(tr, (points) => nudgeSize(points, direction)));
  return viaFormatTarget({ format: 'textSizeStep', direction, by: 'point' }, change);
}

/** One step larger (1) or smaller (-1), from small through normal to extra large. False at either end. Text sized
 * in points steps through Word's list instead, so a version 2 size never jumps back to a name. */
export function stepTextSize(direction: 1 | -1): Command {
  return viaFormatTarget({ format: 'textSizeStep', direction }, (state, dispatch) => {
    const size = currentTextSize(state);
    const at = SIZE_STEPS.indexOf(size);
    if (at < 0) return fromChange((tr) => resize(tr, (points) => stepSize(points, direction)))(state, dispatch);
    const next = at + direction;
    if (next < 0 || next >= SIZE_STEPS.length) return false;
    return setTextSize(SIZE_STEPS[next])(state, dispatch);
  });
}

/** Marks that clear character formatting keeps (DESIGN.md 4.1): content, review marks, code, language, direction. */
export const KEPT_ON_CLEAR: ReadonlySet<string> = new Set([...CONTENT_MARKS, 'code', 'lang', 'dir']);

/** Clear character formatting (Word Ctrl+Space): takes off every run format but the kept marks. The paragraph's
 * style and its paragraph formatting stay. */
export const clearFormattingChange: Change = (tr) => {
  const marks = Object.values(tr.doc.type.schema.marks).filter((type) => !KEPT_ON_CLEAR.has(type.name));
  if (tr.selection.empty) {
    tr.setStoredMarks(
      (tr.storedMarks ?? tr.selection.$from.marks()).filter((mark) => KEPT_ON_CLEAR.has(mark.type.name)),
    );
    return true;
  }
  for (const range of tr.selection.ranges) {
    for (const type of marks) tr.removeMark(range.$from.pos, range.$to.pos, type);
  }
  return true;
};

export function clearFormatting(): Command {
  return viaFormatTarget({ format: 'clear' }, fromChange(clearFormattingChange));
}
