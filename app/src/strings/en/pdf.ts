// PDF pages, note space, handouts, scans, highlights, and text in pictures (Phase 11 and 12). One namespace, owned by
// features/pdf, so parallel work never edits the same strings file.

export const pdf = {
  commands: {
    import: 'Import PDF as pages',
    insert: 'Insert PDF',
    noteSpace: 'Add note space',
    handouts: 'Make handouts',
    keywords: 'pdf document slides printout lecture handout annotate note space margin lines',
  },
  pageAlt: 'Page {page} of {pages} from {file}',
  pageTitle: '{file}, page {page}',
  progress: 'Reading page {done} of {total} of {name}…',
  stop: 'Stop',
  stopped: 'Stopped. Nothing was added.',
  needSection: 'Open a section first, so the new pages have a place to go.',
  imported: '{count, plural, one {Added # page from {name}.} other {Added # pages from {name}.}}',
  importedSome:
    '{count, plural, one {Added # page from {name}.} other {Added # pages from {name}.}} Pages {missed} could not be read.',
  inserted: '{count, plural, one {Added # page of {name} to this page.} other {Added # pages of {name} to this page.}}',
  errors: {
    tooBig: '{name} is bigger than 200 MB, so OpenNote did not open it.',
    unreadable: '{name} could not be read. It may be damaged or not a PDF.',
    locked: '{name} is locked with a password. Open it in another app, remove the password, and try again.',
    empty: '{name} has no pages.',
  },
  noteSpace: {
    title: 'Add note space',
    description: 'Adds room to write beside PDF pages and slides. The page picture stays as it is.',
    run: 'Add note space',
    side: 'Where',
    sides: { right: 'On the right', bottom: 'Below', both: 'On the right and below' },
    alt: { ruled: 'Ruled note space', blank: 'Blank note space' },
    done: '{count, plural, one {Added note space to # page.} other {Added note space to # pages.}}',
    none: 'No PDF pages or slides to add note space to.',
  },
  handouts: {
    title: 'Make handouts',
    pageTitle: 'Handout {number}',
    description:
      'Lays out PDF pages or slides 2 or 3 to a page, with lines beside each one, in new pages at the end of the section.',
    run: 'Make handouts',
    perSheet: 'On each page',
    count: '{count} slides',
    done: '{count, plural, one {Made # handout page.} other {Made # handout pages.}}',
    none: 'No PDF pages or slides to put on handouts.',
  },
  paper: { label: 'Paper', ruled: 'Ruled', blank: 'Blank' },
  scope: {
    label: 'Pages',
    page: 'This page',
    range: 'A range of pages in this section',
    all: 'Every page in this section',
    allHelp: 'Only pages with a PDF page or a slide change.',
    from: 'From page',
    to: 'To page',
    invalid: 'Enter page numbers of 1 or more.',
  },
} as const;
