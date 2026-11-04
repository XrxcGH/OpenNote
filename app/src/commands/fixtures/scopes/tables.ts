// The spreadsheet keys of a table in Grid mode and Edit mode. Owner: tables:keys. shared:x-shared wrote the first
// cases from the plan's key table. The IDs are stand-ins until the table commands exist. A chord that Edit mode
// gives its text meaning has no table command, so it falls through to the text program.
import type { ScopeFixture } from './types';

export const tablesScopes: ScopeFixture = {
  program: 'tables',
  owner: 'tables:keys',
  commands: [
    { id: 'table.fillDown', scope: 'tableGrid', keys: ['Ctrl+D'] },
    { id: 'table.fillRight', scope: 'tableGrid', keys: ['Ctrl+R'] },
    { id: 'table.fillEntry', scope: 'tableGrid', keys: ['Ctrl+Enter'] },
    { id: 'table.selectColumn', scope: 'tableGrid', keys: ['Ctrl+Space'] },
    { id: 'table.calculateNow', scope: 'tableGrid', keys: ['F9'] },
    { id: 'table.showFormulas', scope: 'tableGrid', keys: ['Ctrl+`'] },
    { id: 'table.commitStay', scope: 'tableEdit', keys: ['Ctrl+Enter'] },
    { id: 'table.evaluatePart', scope: 'tableEdit', keys: ['F9'] },
    // Table-only chords in both modes.
    { id: 'table.strikethrough', scope: 'editor.table', keys: ['Ctrl+5'] },
    { id: 'table.insertFunction', scope: 'editor.table', keys: ['Shift+F3'] },
  ],
  cases: [
    { chord: 'Ctrl+D', at: 'tableGrid', expect: 'table.fillDown', why: 'Grid: fill down' },
    { chord: 'Ctrl+D', at: 'tableEdit', expect: 'format.fontDialog', why: 'Edit: the text meaning, Font' },
    { chord: 'Ctrl+R', at: 'tableGrid', expect: 'table.fillRight', why: 'Grid: fill right' },
    { chord: 'Ctrl+R', at: 'tableEdit', expect: 'format.alignRight', why: 'Edit: align right, as the cell alignment' },
    { chord: 'Ctrl+Enter', at: 'tableGrid', expect: 'table.fillEntry', why: 'Grid: fill the range with the entry' },
    { chord: 'Ctrl+Enter', at: 'tableEdit', expect: 'table.commitStay', why: 'Edit: commit and stay' },
    { chord: 'Ctrl+5', at: 'tableGrid', expect: 'table.strikethrough', why: 'Grid: strikethrough on the range' },
    { chord: 'Ctrl+5', at: 'tableEdit', expect: 'table.strikethrough', why: 'Edit: strikethrough on the text' },
    { chord: 'Shift+F3', at: 'tableGrid', expect: 'table.insertFunction', why: 'Grid: insert function' },
    { chord: 'Shift+F3', at: 'tableEdit', expect: 'table.insertFunction', why: 'Edit: insert function' },
    { chord: 'Ctrl+Space', at: 'tableGrid', expect: 'table.selectColumn', why: 'Grid: select the column' },
    { chord: 'Ctrl+Space', at: 'tableEdit', expect: 'format.clearCharacter', why: 'Edit: clear formatting' },
    { chord: 'F9', at: 'tableGrid', expect: 'table.calculateNow', why: 'Grid: calculate now' },
    { chord: 'F9', at: 'tableEdit', expect: 'table.evaluatePart', why: 'Edit: evaluate the selected part' },
    { chord: 'Ctrl+`', at: 'tableGrid', expect: 'table.showFormulas', why: 'Grid: show formulas' },
    { chord: 'Ctrl+`', at: 'tableEdit', expect: 'format.inlineCode', why: 'Edit: inline code' },
    { chord: 'Ctrl+K', at: 'tableGrid', disabled: ['format.link'], expect: 'app.palette', why: 'Grid: the palette' },
  ],
};
