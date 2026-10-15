// Importing OneNote notebooks through a Microsoft account.

export const accountsOnenote = {
  commands: {
    import: 'Import OneNote notebooks from Microsoft',
    keywords: 'onenote microsoft import notebooks graph office 365 onedrive',
  },
  working: 'Reading your OneNote notebooks…',
  progress: 'Brought in {done} of {total} pages.',
  done: '{notebooks, plural, one {# notebook} other {# notebooks}} came over, with {pages, plural, one {# new page} other {# new pages}}. The Import report page lists what did not come over.',
  doneLeft:
    '{left, plural, one {# page could not be read} other {# pages could not be read}}. The Import report page says which.',
  untitledNotebook: 'Untitled notebook',
  untitledSection: 'Untitled section',
  untitledPage: 'Untitled page',
  untitledFile: 'Attached file',
  pick: {
    title: 'Import OneNote notebooks',
    description: 'Choose a notebook. Nothing in OneNote is changed. Each notebook becomes a notebook here.',
    confirm: 'Import',
    all: 'All my notebooks',
    none: 'No notebooks were found in this Microsoft account.',
  },
  report: {
    section: 'Import report',
    title: 'Import report',
    intro:
      'This page lists what came over from OneNote on {date} and what did not. Running the import again adds new pages and leaves the pages already here as they are.',
    counts:
      '{sections, plural, one {# section} other {# sections}} read. {pages, plural, one {# new page} other {# new pages}} added. {kept, plural, one {# page was} other {# pages were}} already here and left alone.',
    failedPages: 'These pages could not be read and were not brought in:',
    changed:
      'These pages changed in OneNote after they were brought in. They were left as they are here, because they may hold your own writing:',
    tables: 'Tables came over as text tables on these pages:',
    attached: '{count, plural, one {# attached file came over} other {# attached files came over}} as files on their pages.',
    inked: '{count, plural, one {# stroke of ink came over} other {# strokes of ink came over}}, drawn as ink on their pages.',
    attachments: 'These attached files could not be brought over and stay in OneNote. Their names are marked in the text:',
    pictures: '{count, plural, one {# picture} other {# pictures}} could not be fetched. They are missing from:',
    pictureWhy: 'The picture could not be fetched.',
    pageWhy: 'OneNote did not give the page.',
  },
} as const;
