// The format target seam. Every run-format and alignment command asks this registry first. A target claims a kind
// of selection, such as a range of table cells, and applies the format its own way: a whole cell's format goes to
// the cell style instead of the runs of its text. With no target registered, or none that claims the selection,
// the command acts on the text as it always has.
//
// shared:x-shared wrote this stub. text:editor-commands owns it next, and tables registers the cell-range target
// from features/tables/sheet/formatTarget.ts.
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Command } from './command';

/** The formats a target can take. Each command sends one request, with its value where it has one. */
export type FormatRequest =
  | { format: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'subscript' | 'superscript' }
  /** null is the default highlighter, and 'none' takes the highlight off. */
  | { format: 'highlight'; color: string | null }
  | { format: 'textColor'; color: string | null }
  | { format: 'textSize'; size: string | null }
  | { format: 'textSizeStep'; direction: 1 | -1 }
  | { format: 'clear' }
  | { format: 'align'; align: 'left' | 'center' | 'right' | 'justify' };

export interface FormatTarget {
  /** Such as 'tables.cellRange'. */
  id: string;
  /** Whether the target owns the editor's current selection. */
  claims(state: EditorState): boolean;
  /** Applies the format, as a ProseMirror command does: with no dispatch, it only says whether it could. */
  apply(request: FormatRequest, state: EditorState, dispatch?: (tr: Transaction) => void): boolean;
}

const targets: FormatTarget[] = [];

/** Adds a target. Returns a function that removes it. A later target is asked before an earlier one. */
export function registerFormatTarget(target: FormatTarget): () => void {
  targets.unshift(target);
  return () => {
    const at = targets.indexOf(target);
    if (at >= 0) targets.splice(at, 1);
  };
}

/** The target that claims the selection, or null when the text takes the format. */
export function formatTargetFor(state: EditorState): FormatTarget | null {
  return targets.find((target) => target.claims(state)) ?? null;
}

/** A command that offers the request to the target that claims the selection, and otherwise runs `onText`. */
export function viaFormatTarget(request: FormatRequest, onText: Command): Command {
  return (state, dispatch) => {
    const target = formatTargetFor(state);
    return target ? target.apply(request, state, dispatch) : onText(state, dispatch);
  };
}
