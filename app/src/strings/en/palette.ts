// The command palette and the quick switcher.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const palette = {
  title: 'Command palette',
  input: 'Search commands and pages',
  placeholder: 'Type a command or a page name',
  switcherTitle: 'Go to a page',
  switcherInput: 'Page name',
  switcherPlaceholder: 'Type a page name',
  results: 'Results',
  filters: 'Show',
  filter: {
    all: 'All',
    pages: 'Pages',
    commands: 'Commands',
  },
  groups: {
    commands: 'Commands',
    notebooks: 'Notebooks',
    sections: 'Sections',
    pages: 'Pages',
    other: 'More results',
  },
  count: '{count, plural, one {# result} other {# results}}',
  none: 'No results',
  many: 'More than 100 results',
  createPage: 'Create page "{title}"',
  noMatchCreate: 'No pages match. Press Enter to create "{title}".',
  created: 'Created page "{title}".',
  createFailed: 'Couldn\'t create "{title}". Try again, or add the page from the pages list.',
} as const;
