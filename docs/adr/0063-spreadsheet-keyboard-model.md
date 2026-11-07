# ADR 0063: Tables use a spreadsheet keyboard model with grid and edit modes

- Status: Proposed
- Date: 2026-11-01

## Context

Table keys today are a text editor's (`app/src/editor/table/tableKit.ts`): arrows move the caret through text, Enter and Shift+Enter add a line break, and Tab moves to the next cell. Spreadsheet users expect an active cell that arrows move, typing that replaces a cell, Enter that commits and moves down, F2 to edit, Ctrl+arrows to jump, Ctrl+D to fill, and about 40 more chords. Word and Docs table users expect the text-editor behavior. Several spreadsheet chords are already bound in the app (Ctrl+K palette, Ctrl+D, Ctrl+R, Ctrl+1, Ctrl+Enter, Ctrl+0, Ctrl+9).

## Decision

We will give tables two modes. Grid mode (Excel's Ready mode) has an active cell and a range; Edit mode is today's text editing inside one cell. Clicking text enters Edit mode as today; Esc or a click on a cell's padding enters Grid mode. Grid mode has Excel's keys (DESIGN.md section 11.2). Edit mode commits with Enter and moves down, adds a line break with Alt+Enter, and keeps text keys otherwise. A table can be set to Document keys (Enter adds a line break, as today), stored as `data.sheet.table.keys`, and the setting "New tables use spreadsheet keys" decides the default (recommended on). In Grid mode the table's chords win over app chords except Ctrl+K, which stays the command palette. Every chord is rebindable and listed on the shortcuts page.

## Options considered

| Option | For | Against |
|---|---|---|
| Two modes with a per-table Document keys option (chosen) | Spreadsheet parity; Word-like editing still one click away | Two modes to learn and to announce |
| Keep text-editor keys and add chords | No change for current users | Arrows and Enter never behave like a spreadsheet; parity fails |
| Spreadsheet keys only | Simplest for spreadsheet users | Writing prose in a cell (common in notes) becomes awkward |

## Consequences

- Screen readers get roving focus on the active cell and an announcement per move (DESIGN.md section 17).
- The shortcuts page and help gain a table section for both modes.
- Changing a chord that collides with an app chord needs a scoped keymap context in `state/keymap.ts`.

## Implementation notes

The keys live in `app/src/features/tables/keys/` (tables:keys, B10), behind the flag `tables.sheetWrites`:

- Grid mode is a cell selection. Its anchor is the active cell; once Enter or Tab moves through a range, the plugin keeps the active cell beside the range. Edit mode is the caret in a cell's text. An entry begun by typing, Backspace, F2, or Ctrl+' remembers the cell's content, so Esc puts it back. An entry begun by typing or Backspace is Enter mode, where arrows finish it and move.
- A ProseMirror plugin, registered first through the table extra (`features/page/tables/extras.ts`), handles the keys. Chords a person may change are commands in the registry, in the scopes `tableGrid`, `tableEdit`, and `editor.table` that `commands/keymap.ts` already nests under the editor. The plugin looks up the person's own chords, so rebinding works. The app's key handler runs the chords that reach commands from a text field (Ctrl, Alt, function keys); the plugin runs the rest. Ctrl+D, Ctrl+R, and Ctrl+Enter refine the table's existing commands, so the registry has no conflicts.
- The navigation keys that `commands/reserved.ts` keeps free (arrows, Enter, Tab, Home, Page Up, Page Down, and Esc) and Shift+Space are fixed. The shortcut list shows them in a Table keys section; the changeable chords are in its Table group.
- Esc on a single cell goes on to the editor, which selects the table as an object, so the keyboard can always leave the table.
- `data.sheet.table.keys` is `spreadsheet` or `document` (spec R-SHT-10). Insert table stores the setting "New tables use spreadsheet keys". A table that stores nothing keeps document keys when it holds only text, and uses spreadsheet keys when a cell holds a number or a formula (PLAN.md decision 4). The table menu's "Use document keys in this table" switches it.
- Screen readers: every cell has `aria-rowindex` and `aria-colindex`, and in Grid mode the range has `aria-selected`. DOM focus stays on the editor, because a cell inside an editable region cannot take focus without breaking the editor's selection, and the editor's root has no role that allows `aria-activedescendant`. So instead of roving `tabindex`, each move says the address, header, shown value, and formula in words through the polite live region. The active cell has a thick outline in Grid mode and a thin one in Edit mode.
- Ctrl+5 is not bound: Ctrl+1 to Ctrl+9 stay free for tags. Bold, italic, underline, and the strikethrough command already format the text of selected cells. Keys that other lanes own (Ctrl+1, F4, Alt+=, the number format, border, structure, filter, note, function, and paste chords) register in the same scopes.
