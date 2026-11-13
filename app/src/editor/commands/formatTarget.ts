// The format target seam. Every run-format and alignment command asks this registry first. A target claims a kind
// of selection, such as a range of table cells, and applies the format its own way: a whole cell's format goes to
// the cell style instead of the runs of its text. With no target registered, or none that claims the selection,
// the command acts on the text as it always has.
//
// shared:x-shared wrote the stub. text:editor-commands owns it, and tables registers the cell-range target from
// features/tables/sheet/formatTarget.ts. A target that does not take a request returns false from apply.
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { HighlightColor } from '../schema/specs';
import type { Command } from './command';

/**
 * The formats a target can take. Each command sends one request, with its value where it has one. `toggle` says
 * whether the command turns the format off when the selection has it already (true) or always sets it (false).
 */
export type FormatRequest =
  /** Bold and the other plain marks always toggle. */
  | { format: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'subscript' | 'superscript'; toggle: true }
  /** null is the default highlighter. */
  | { format: 'highlight'; color: HighlightColor | null; toggle: boolean }
  /** Takes the highlight off. */
  | { format: 'highlight'; color: 'none'; toggle: false }
  | { format: 'textColor'; color: string | null }
  | { format: 'textSize'; size: string | null }
  /** By Word's preset list (the default), or by one point. */
  | { format: 'textSizeStep'; direction: 1 | -1; by?: 'preset' | 'point' }
  /** Character formatting (the default), or character and paragraph formatting with the Normal style. */
  | { format: 'clear'; scope?: 'character' | 'all' }
  | { format: 'align'; align: 'left' | 'center' | 'right' | 'justify' | 'distribute' }
  /** Any other run format: a mark of inline version 2 with its attributes, or null attributes to take it off. */
  | { format: 'run'; mark: string; attrs: Record<string, unknown> | null; toggle: boolean }
  /** A paragraph format: a `paras` key and its value, or null to take the key off. */
  | { format: 'para'; key: string; value: unknown };

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
    // A target that has no meaning for the request (highlight on whole cells) leaves it to the text.
    return target ? target.apply(request, state, dispatch) || onText(state, dispatch) : onText(state, dispatch);
  };
}
