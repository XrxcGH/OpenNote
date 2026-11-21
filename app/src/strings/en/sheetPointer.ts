// The pointer, touch, and pen parts of a table: the fill handle, touch handles, and Draw border and Erase border.
// Owner: tables:pointer (B11). Every interface string is a full sentence, never joined from pieces.

export const sheetPointer = {
  command: {
    drawBorder: 'Draw border',
    drawBorderKeywords: 'pen line cell edge gridline table outline',
    eraseBorder: 'Erase border',
    fillSeriesDown: 'Fill series down',
    fillSeriesRight: 'Fill series right',
    fillSeriesKeywords: 'drag handle autofill continue sequence numbers dates days months',
    eraseBorderKeywords: 'pen remove clear line cell edge gridline table outline',
  },
  fill: {
    menu: 'Fill options',
    copy: 'Copy cells',
    series: 'Fill series',
    formats: 'Fill formatting only',
    values: 'Fill without formatting',
    menuOpen: 'Fill options are available. Press Alt and Down Arrow to choose, or Control and Z to undo.',
    filled: 'Filled {count} cells.',
    filledFormats: 'Filled the formatting of {count} cells.',
    nothing: 'There is nothing to fill there.',
  },
  border: {
    drawOn: 'Draw border is on. Drag along the lines of the table. Press Escape to stop.',
    eraseOn: 'Erase border is on. Drag along the lines of the table. Press Escape to stop.',
    off: 'Border drawing is off.',
    drawn: 'Drew {count} cell borders.',
    erased: 'Erased {count} cell borders.',
  },
} as const;
