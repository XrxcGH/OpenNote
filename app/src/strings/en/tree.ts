// The notebooks and pages trees, the page area, and Trash.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const tree = {
  empty: {
    notebooks: 'No notebooks yet.',
    pages: 'No pages in this section yet.',
    noSection: 'Choose a section to see its pages.',
  },
  page: {
    none: 'Choose a page to see it here.',
  },
  trash: {
    title: 'Trash',
  },
} as const;
