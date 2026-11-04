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
