// The page area (owner after WP0: WP3): the page view, blocks, objects, and page zoom. Every interface string is a
// full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const page = {
  zoom: {
    in: 'Zoom page in',
    out: 'Zoom page out',
    reset: 'Actual page size',
    fitWidth: 'Fit page to width',
    keywords: 'zoom page magnify bigger smaller scale',
    announce: 'Page zoom {percent} percent.',
  },
  block: {
    text: 'Text box',
    textEditor: 'Text',
    placeholder: 'Start writing',
    image: 'Image: {alt}',
    imageUnnamed: 'Image without a description',
    table: 'Table',
    unknown: 'A {type} block that this version can’t show yet',
  },
  selection: {
    count: '{count, plural, one {# item selected.} other {# items selected.}}',
  },
  openFailed: 'This page couldn’t be opened. Try again, or choose another page.',
} as const;
