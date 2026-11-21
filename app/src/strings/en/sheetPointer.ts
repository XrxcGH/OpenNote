// The pointer, touch, and pen parts of a table: the fill handle, touch handles, and Draw border and Erase border.
// Owner: tables:pointer (B11). Every interface string is a full sentence, never joined from pieces.

export const sheetPointer = {
  command: {
    drawBorder: 'Draw border',
    drawBorderKeywords: 'pen line cell edge gridline table outline',
    eraseBorder: 'Erase border',
    eraseBorderKeywords: 'pen remove clear line cell edge gridline table outline',
  },
  fill: {
    handle: 'Fill handle. Drag to fill the cells below or beside the selection.',
    menu: 'Fill options',
    copy: 'Copy cells',
    series: 'Fill series',
    formats: 'Fill formatting only',
    values: 'Fill without formatting',
    filled: 'Filled {count} cells.',
    filledFormats: 'Filled the formatting of {count} cells.',
    nothing: 'There is nothing to fill there.',
  },
  handles: {
    start: 'Selection handle at the first corner. Drag to change the range.',
    end: 'Selection handle at the last corner. Drag to change the range.',
  },
  border: {
    drawOn: 'Draw border is on. Drag along the lines of the table. Press Escape to stop.',
    eraseOn: 'Erase border is on. Drag along the lines of the table. Press Escape to stop.',
    off: 'Border drawing is off.',
    drawn: 'Drew {count} cell borders.',
    erased: 'Erased {count} cell borders.',
    refused: 'There are too many different cell styles to draw this border.',
  },
  row: {
    height: 'Row height set to {height}.',
    fit: 'Row height now fits the content.',
  },
} as const;
