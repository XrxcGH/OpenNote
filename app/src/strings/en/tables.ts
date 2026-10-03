// Table commands and the table toolbar (owner: WP6). Every interface string is a full sentence here, never joined
// from pieces (ARCHITECTURE.md section 19).

export const tables = {
  name: 'Table: {columns}',
  nameUnnamed: 'Table',
  block: 'Table',
  commands: {
    insert: 'Insert table',
    insertKeywords: 'table grid rows columns cells spreadsheet',
    rowAbove: 'Add row above',
    rowBelow: 'Add row below',
    columnLeft: 'Add column left',
    columnRight: 'Add column right',
    deleteRow: 'Delete row',
    deleteColumn: 'Delete column',
    deleteTable: 'Delete table',
    headerRow: 'Header row',
    moveRowUp: 'Move row up',
    moveRowDown: 'Move row down',
    columnWidth: 'Column width…',
    select: 'Select table',
    keywords: 'table row column cell header',
  },
  toolbar: {
    label: 'Table tools',
    more: 'More table commands',
  },
  menu: {
    label: 'Table',
  },
  width: {
    label: 'Column width',
    unit: 'pixels',
    apply: 'Apply',
    hint: 'From {min} to {max} pixels.',
    resize: 'Resize column {column}',
  },
  announce: {
    rowAdded: 'Row added.',
    columnAdded: 'Column added.',
    rowDeleted: 'Row deleted.',
    columnDeleted: 'Column deleted.',
    tableDeleted: 'Table deleted.',
    headerOn: 'Header row on.',
    headerOff: 'Header row off.',
    rowMoved: 'Row moved to position {position}.',
    width: 'Column width {width} pixels.',
    inserted: 'Table inserted, 3 columns by 3 rows.',
    selected: 'Table selected.',
  },
} as const;
