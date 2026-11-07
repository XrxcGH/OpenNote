// The spreadsheet keys of a table (DESIGN.md section 11.2, ADR 0063), as data. Chords that a person may change
// are commands in the one command registry, scoped to Grid mode (tableGrid), Edit mode (tableEdit), or both
// (editor.table). The navigation keys that reserved.ts keeps free are fixed, as in every other editor.
//
// Keys that feature lanes own are not here. They register their own commands in the same scopes:
// - Ctrl+1: format-dialog. F4, Alt+=, Shift+F3, and F9: formula-bar and the engine.
// - Number format and border chords: toolbar. Ctrl+9, Ctrl+0, and the insert and delete chords: structure.
// - Ctrl+Shift+L: data-tools. Shift+F2: notes. The paste chords: clipboard.
// Ctrl+5 is not here: Ctrl+1 to Ctrl+9 stay free for tags, and
// Ctrl+B, Ctrl+I, Ctrl+U, and the strikethrough command already format the text of selected cells.
import type { CommandId, KeyScope } from '../../../commands/types';
import type { MessageKey } from '../../../strings/t';

export type SheetScope = Extract<KeyScope, 'tableGrid' | 'tableEdit' | 'editor.table'>;

export interface SheetKeyDef {
  id: CommandId;
  title: MessageKey;
  keys: readonly string[];
  scope: SheetScope;
  /** Shown in the command palette. Moves are not; fills, dates, and the mode switch are. */
  palette?: boolean;
  /** The less specific command that shares the chord outside this mode (AMENDMENTS.md P2-2). */
  refines?: CommandId;
}

const def = (
  name: string,
  keys: readonly string[],
  scope: SheetScope,
  palette = false,
  refines?: CommandId,
): SheetKeyDef => ({
  id: `table.sheet.${name}`,
  title: `sheetKeys.commands.${name}` as MessageKey,
  keys,
  scope,
  palette,
  ...(refines ? { refines } : {}),
});

const GRID = 'tableGrid';
const EDIT = 'tableEdit';
const BOTH = 'editor.table';

export const SHEET_KEYS: readonly SheetKeyDef[] = [
  def('extendUp', ['Shift+Up'], GRID),
  def('extendDown', ['Shift+Down'], GRID),
  def('extendLeft', ['Shift+Left'], GRID),
  def('extendRight', ['Shift+Right'], GRID),
  def('jumpUp', ['Ctrl+Up'], GRID),
  def('jumpDown', ['Ctrl+Down'], GRID),
  def('jumpLeft', ['Ctrl+Left'], GRID),
  def('jumpRight', ['Ctrl+Right'], GRID),
  def('extendJumpUp', ['Ctrl+Shift+Up'], GRID),
  def('extendJumpDown', ['Ctrl+Shift+Down'], GRID),
  def('extendJumpLeft', ['Ctrl+Shift+Left'], GRID),
  def('extendJumpRight', ['Ctrl+Shift+Right'], GRID),
  def('firstCell', ['Ctrl+Home'], GRID),
  def('lastCell', ['Ctrl+End'], GRID),
  def('extendFirstCell', ['Ctrl+Shift+Home'], GRID),
  def('extendLastCell', ['Ctrl+Shift+End'], GRID),
  def('extendRowStart', ['Shift+Home'], GRID),
  def('screenLeft', ['Alt+PageUp'], GRID),
  def('screenRight', ['Alt+PageDown'], GRID),
  def('moveUp', ['Shift+Enter'], GRID),
  def('fillEntry', ['Ctrl+Enter'], GRID, false, 'table.rowBelow'),
  def('edit', ['F2'], GRID),
  def('clear', ['Delete'], GRID),
  def('clearAndEdit', ['Backspace'], GRID),
  def('selectColumn', ['Ctrl+Space'], GRID),
  def('selectRegion', ['Ctrl+A'], GRID),
  def('fillDown', ['Ctrl+D'], GRID, true, 'table.fillDown'),
  def('fillRight', ['Ctrl+R'], GRID, true, 'table.fillRight'),
  def('copyFormulaAbove', ["Ctrl+'"], GRID),
  def('copyValueAbove', ['Ctrl+"'], GRID),
  def('insertDate', ['Ctrl+;'], BOTH, true),
  // Ctrl+Shift+; types ":" on a US keyboard, so the chord names the typed character.
  def('insertTime', ['Ctrl+:'], BOTH, true),
  def('commitUp', ['Shift+Enter'], EDIT),
  def('commitStay', ['Ctrl+Enter'], EDIT, false, 'table.rowBelow'),
  def('lineBreak', ['Alt+Enter'], EDIT),
  def('toggleEnterMode', ['F2'], EDIT),
  def('documentKeys', [], BOTH, true),
];

/** The command that turns document keys on and off for the table with focus. */
export const DOCUMENT_KEYS_COMMAND: CommandId = 'table.sheet.documentKeys';

export interface SheetFixedRow {
  readonly id: string;
  /** Chords in the canonical form, or a message for keys that aren't one. */
  readonly keys: readonly string[] | MessageKey;
  readonly action: MessageKey;
}

/** The fixed keys of a spreadsheet table, for the shortcut list. The plugin handles them itself. */
export const SHEET_FIXED_KEYS: readonly SheetFixedRow[] = [
  { id: 'gridArrows', keys: ['Up', 'Down', 'Left', 'Right'], action: 'sheetKeys.fixed.gridArrows' },
  { id: 'gridEnter', keys: ['Enter'], action: 'sheetKeys.fixed.gridEnter' },
  { id: 'gridTab', keys: ['Tab', 'Shift+Tab'], action: 'sheetKeys.fixed.gridTab' },
  { id: 'gridHome', keys: ['Home'], action: 'sheetKeys.fixed.gridHome' },
  { id: 'gridPage', keys: ['PageUp', 'PageDown'], action: 'sheetKeys.fixed.gridPage' },
  { id: 'gridEscape', keys: ['Escape'], action: 'sheetKeys.fixed.gridEscape' },
  { id: 'gridSpace', keys: ['Shift+Space'], action: 'sheetKeys.fixed.gridSpace' },
  { id: 'gridType', keys: 'sheetKeys.fixed.typeKey', action: 'sheetKeys.fixed.gridType' },
  { id: 'editEnter', keys: ['Enter'], action: 'sheetKeys.fixed.editEnter' },
  { id: 'editEscape', keys: ['Escape'], action: 'sheetKeys.fixed.editEscape' },
  { id: 'editArrows', keys: ['Up', 'Down', 'Left', 'Right'], action: 'sheetKeys.fixed.editArrows' },
];
