// Character formatting (owner: WP4): the marks people toggle, highlight and text colors, text sizes, and clearing.
// Each function is a ProseMirror command, so the page's commands, the formatting bar, and tests share one body.
import type { MarkType } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { HighlightColor, TextSizeName } from '../schema/specs';
import { fromChange, selectedTextblocks } from './command';
import type { Change, Command } from './command';
import { isMarkActive, markAttrs } from './state';

export { isMarkActive, markAttrs } from './state';

export type ToggledMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'subscript' | 'superscript';

/** Text sizes from small to extra large. Normal text has no mark, so it sits between small and large. */
const SIZE_STEPS: readonly (TextSizeName | null)[] = ['small', null, 'large', 'xlarge'];

/** Adds the mark to the selection, replacing one of the same type, or stores it for typing at a caret. */
function addMark(tr: Transaction, type: MarkType, attrs: Record<string, unknown> | null): boolean {
  const { selection } = tr;
  const mark = type.create(attrs);
  if (selection.empty) {
    const marks = tr.storedMarks ?? selection.$from.marks();
    if (!mark.isInSet(marks) && !type.isInSet(marks) && !canMark(tr, type)) return false;
    tr.setStoredMarks(mark.addToSet(type.removeFromSet(marks)));
    return true;
  }
  if (!canMark(tr, type)) return false;
  for (const range of selection.ranges) {
    tr.removeMark(range.$from.pos, range.$to.pos, type);
    tr.addMark(range.$from.pos, range.$to.pos, mark);
  }
  return true;
}

function removeMark(tr: Transaction, type: MarkType): boolean {
  const { selection } = tr;
  if (selection.empty) {
    tr.setStoredMarks(type.removeFromSet(tr.storedMarks ?? selection.$from.marks()));
    return true;
  }
  for (const range of selection.ranges) tr.removeMark(range.$from.pos, range.$to.pos, type);
  return true;
}

/** Whether some textblock in the selection allows the mark (code blocks allow none). */
function canMark(tr: Transaction, type: MarkType): boolean {
  return selectedTextblocks(tr).some(({ node }) => node.type.allowsMarkType(type));
}

/** Bold, italic, and the other marks without attributes: on unless the whole selection has it already. */
export function toggleMark(name: ToggledMark): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[name];
    const active = isMarkActive(state, name);
    return fromChange((tr) => (active ? removeMark(tr, type) : addMark(tr, type, null)))(state, dispatch);
  };
}

/** Highlight in a color; null is Honey. The same color again takes the highlight off. */
export function toggleHighlight(color: HighlightColor | null = null): Command {
  return (state, dispatch) => {
    const type = state.schema.marks.highlight;
    const active = isMarkActive(state, 'highlight', { color });
    return fromChange((tr) => (active ? removeMark(tr, type) : addMark(tr, type, { color })))(state, dispatch);
  };
}

/** Sets the highlight color, or takes the highlight off with `'none'`. */
export function setHighlight(color: HighlightColor | null | 'none'): Command {
  return fromChange((tr) => {
    const type = tr.doc.type.schema.marks.highlight;
    return color === 'none' ? removeMark(tr, type) : addMark(tr, type, { color });
  });
}

/** A pen name or `#rrggbb`; null takes the color off. */
export function setTextColor(color: string | null): Command {
  return fromChange((tr) => {
    const type = tr.doc.type.schema.marks.textColor;
    return color === null ? removeMark(tr, type) : addMark(tr, type, { color });
  });
}

/** A text size; null is normal size. */
export function setTextSize(size: TextSizeName | null): Command {
  return fromChange((tr) => {
    const type = tr.doc.type.schema.marks.textSize;
    return size === null ? removeMark(tr, type) : addMark(tr, type, { size });
  });
}

/** The size of the selection's first character, or null for normal text. */
export function currentTextSize(state: EditorState): TextSizeName | null {
  return (markAttrs(state, 'textSize')?.size as TextSizeName | undefined) ?? null;
}

/** One step larger (1) or smaller (-1), from small through normal to extra large. False at either end. */
export function stepTextSize(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const at = SIZE_STEPS.indexOf(currentTextSize(state));
    const next = at + direction;
    if (next < 0 || next >= SIZE_STEPS.length) return false;
    return setTextSize(SIZE_STEPS[next])(state, dispatch);
  };
}

/** Takes off every character format but links, which are content rather than formatting. */
export const clearFormattingChange: Change = (tr) => {
  const marks = Object.values(tr.doc.type.schema.marks).filter((type) => type.name !== 'link');
  if (tr.selection.empty) {
    tr.setStoredMarks((tr.storedMarks ?? tr.selection.$from.marks()).filter((mark) => mark.type.name === 'link'));
    return true;
  }
  for (const range of tr.selection.ranges) {
    for (const type of marks) tr.removeMark(range.$from.pos, range.$to.pos, type);
  }
  return true;
};

export function clearFormatting(): Command {
  return fromChange(clearFormattingChange);
}
