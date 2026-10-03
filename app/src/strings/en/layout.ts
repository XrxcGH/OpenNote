// Regions, panes, splitters, rails, the drawer, the compact app bar, and history.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const layout = {
  regions: {
    commands: 'Commands',
    notebooks: 'Notebooks',
    pages: 'Pages',
  },
  commands: {
    toggleNotebooks: 'Notebooks pane',
    togglePages: 'Pages pane',
    widerNotebooks: 'Widen the notebooks pane',
    narrowerNotebooks: 'Narrow the notebooks pane',
    resetNotebooks: 'Reset the notebooks pane width',
    collapseNotebooks: 'Collapse the notebooks pane',
    expandNotebooks: 'Expand the notebooks pane',
    widerPages: 'Widen the pages pane',
    narrowerPages: 'Narrow the pages pane',
    resetPages: 'Reset the pages pane width',
    collapsePages: 'Collapse the pages pane',
    expandPages: 'Expand the pages pane',
    paneWidths: 'Pane widths',
    nextRegion: 'Go to the next region',
    previousRegion: 'Go to the previous region',
    back: 'Go back',
    forward: 'Go forward',
    revealInTree: 'Reveal in tree',
  },
  keywords: {
    panes: 'show hide collapse expand sidebar pane',
    history: 'history previous next',
  },
  announce: {
    notebooksShown: 'Notebooks pane shown',
    notebooksHidden: 'Notebooks pane hidden',
    pagesShown: 'Pages pane shown',
    pagesHidden: 'Pages pane hidden',
  },
  rail: {
    showNotebooks: 'Show notebooks',
    showPages: 'Show pages',
    newPage: 'New page',
    notebookColor: '{notebook} notebook, {color}',
  },
  chipColors: {
    ink: 'Ink',
    indigo: 'Indigo',
    brick: 'Brick',
    fern: 'Fern',
    plum: 'Plum',
    amber: 'Amber',
    walnut: 'Walnut',
  },
  splitter: {
    notebooks: 'Resize the notebooks pane',
    pages: 'Resize the pages pane',
    notebooksValue: 'Notebooks pane, {width} pixels',
    pagesValue: 'Pages pane, {width} pixels',
    notebooksMenu: 'Notebooks pane width',
    pagesMenu: 'Pages pane width',
  },
  appBar: {
    label: 'Current screen',
    backTo: 'Back to {name}',
    notebooks: 'Notebooks',
  },
} as const;
