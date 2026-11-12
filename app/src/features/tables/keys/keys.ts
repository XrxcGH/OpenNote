// The keys of Grid mode and Edit mode (ADR 0063). Chords a person may change come from the command registry, so
// rebinding works; the navigation keys that reserved.ts keeps free are fixed here. Typing in Grid mode replaces the
// active cell.
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isEnabled } from '../../../app/flags';
import { chordMatches } from '../../../commands/chords';
import { commandsForChord } from '../../../commands/keymap';
import type { CommandId } from '../../../commands/types';
import { cancel, runSheetCommand, typeOver } from './actions';
import { SHEET_KEYS } from './bindings';
import type { SheetScope } from './bindings';
import { boxSize } from './grid';
import { advance, commitBy, move, moveBy, nextInRow, pageOf, selectBox } from './moves';
import type { Ctx } from './moves';
import { activeCell, gridOf, modeOf, sheetKeysKey, textsOf } from './state';
import type { SheetKeysOptions, SheetMode } from './state';

const SCOPES: Readonly<Record<SheetMode, readonly SheetScope[]>> = {
  grid: ['tableGrid', 'editor.table'],
  edit: ['tableEdit', 'editor.table'],
};
const SHEET_IDS = new Set<string>(SHEET_KEYS.map((key) => key.id));

/** The sheet command a key press names in this mode, with the person's own chords. */
function commandFor(event: KeyboardEvent, mode: SheetMode): CommandId | null {
  for (const { chord } of chordMatches(event)) {
    const def = commandsForChord(chord).find(
      (one) =>
        SHEET_IDS.has(one.id) && SCOPES[mode].includes(one.scope as SheetScope) && (!one.flag || isEnabled(one.flag)),
    );
    if (def) return def.id;
  }
  return null;
}

/** A key press that types a character: no Ctrl, Alt, or Meta, unless AltGr makes it. */
function typedText(event: KeyboardEvent): string | null {
  if (event.isComposing || [...event.key].length !== 1) return null;
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  if (event.metaKey || ((event.ctrlKey || event.altKey) && !altGraph)) return null;
  return event.key;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const plain = (event: KeyboardEvent) => !event.ctrlKey && !event.altKey && !event.metaKey;

/** The fixed keys of Grid mode. */
function gridKey(ctx: Ctx, event: KeyboardEvent): boolean {
  const arrow = ARROWS[event.key];
  if (arrow && plain(event) && !event.shiftKey) return moveBy(ctx, arrow[0], arrow[1]);
  if (!plain(event)) return false;
  switch (event.key) {
    case 'Enter':
      return event.shiftKey ? false : advance(ctx, 'column', false);
    case 'Tab':
      return advance(ctx, 'row', event.shiftKey);
    case 'Home':
      return event.shiftKey ? false : moveBy(ctx, 0, -(activeCell(ctx.state)?.column ?? 0));
    case 'PageUp':
    case 'PageDown':
      return event.shiftKey ? false : moveBy(ctx, (event.key === 'PageUp' ? -1 : 1) * pageOf(ctx.view, true), 0);
    case 'Escape': {
      const g = gridOf(ctx.state);
      // One cell: Esc goes on to the editor, which selects the table as an object, so the keyboard can leave.
      return g !== null && boxSize(g.box) > 1 && move(ctx, g.active);
    }
    case ' ':
      if (!event.shiftKey) return false;
      return selectBox(ctx, {
        ...gridOf(ctx.state)!.box,
        left: 0,
        right: Math.max(0, ...ctx.texts.map((r) => r.length)) - 1,
      });
    default:
      return false;
  }
}

/** Whether the caret is at the start or end of its cell's text. */
function atTextEdge(state: EditorState, end: boolean): boolean {
  const { $head, empty } = state.selection;
  return empty && (end ? $head.parentOffset === $head.parent.content.size : $head.parentOffset === 0);
}

function atLineEdge(view: EditorView, down: boolean): boolean {
  try {
    return view.endOfTextblock(down ? 'down' : 'up');
  } catch {
    return true;
  }
}

/**
 * Whether an arrow leaves the table from this cell: up from the first row, down from the last, left from the first
 * cell, or right from the last. The table block's edge keys then move to the block beside the table.
 */
function leavesTable(ctx: Ctx, rows: number, columns: number): boolean {
  const at = activeCell(ctx.state);
  const last = ctx.texts.length - 1;
  if (!at) return false;
  if (rows !== 0) return at.row === (rows < 0 ? 0 : last);
  const width = ctx.texts[last]?.length ?? 0;
  return columns < 0 ? at.row === 0 && at.column === 0 : at.row === last && at.column === width - 1;
}

/** The fixed keys of Edit mode. */
function editKey(ctx: Ctx, event: KeyboardEvent): boolean {
  if (!plain(event)) return false;
  const entry = sheetKeysKey.getState(ctx.state)?.entry;
  const arrow = ARROWS[event.key];
  if (arrow && !event.shiftKey) {
    if (entry?.mode === 'enter') return commitBy(ctx, arrow[0], arrow[1]);
    // Edit mode keeps the caret in the cell, as a spreadsheet's does, except where the arrow leaves the table.
    const edge = arrow[1] !== 0 ? atTextEdge(ctx.state, arrow[1] > 0) : atLineEdge(ctx.view, arrow[0] > 0);
    return edge && !leavesTable(ctx, arrow[0], arrow[1]);
  }
  switch (event.key) {
    case 'Enter':
      return event.shiftKey ? false : commitBy(ctx, 1, 0);
    case 'Tab': {
      // Finish the entry and move as Tab does in Grid mode.
      const at = activeCell(ctx.state);
      return at !== null && nextInRow(ctx, at, event.shiftKey);
    }
    case 'Escape':
      return cancel(ctx);
    default:
      return false;
  }
}

export function handleKey(view: EditorView, event: KeyboardEvent, options: SheetKeysOptions): boolean {
  const mode = modeOf(view.state);
  if (!mode || event.isComposing) return false;
  const id = commandFor(event, mode);
  if (id) {
    // The app's key handler ran it already when the chord reaches commands from a text field.
    if (event.defaultPrevented) return true;
    if (runSheetCommand(view, options, id)) return true;
  }
  const ctx: Ctx = {
    view,
    state: view.state,
    dispatch: (tr) => view.dispatch(tr),
    options,
    texts: textsOf(view.state.doc),
  };
  if (mode === 'edit') return editKey(ctx, event);
  if (gridKey(ctx, event)) return true;
  const text = typedText(event);
  return text !== null && typeOver(ctx, text);
}
