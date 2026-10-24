// Command titles and palette keywords for the app commands, the command bar, and the bottom bar.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const commands = {
  app: {
    palette: 'Open command palette',
    quickSwitcher: 'Go to a page',
    shortcuts: 'Show keyboard shortcuts',
    settings: 'Open settings',
    settingsBack: 'Back to notes',
  },
  keywords: {
    palette: 'search find run commands',
    quickSwitcher: 'open find switch jump page search',
    shortcuts: 'keys keyboard hotkeys cheat sheet',
    settings: 'preferences options',
    settingsBack: 'close settings leave',
  },
  bar: {
    label: 'Commands',
    tabs: 'Command tabs',
    home: 'Home',
    insert: 'Insert',
    draw: 'Draw',
    view: 'View',
    more: 'More',
    moreLabel: 'More commands',
    bottom: 'Quick actions',
    notebooks: 'Notebooks',
    search: 'Search',
    newPage: 'New page',
    settings: 'Settings',
    shortcuts: 'Keyboard shortcuts',
    trash: 'Trash',
    recent: 'Recent pages',
  },
  colors: {
    ink: 'Ink',
    indigo: 'Indigo',
    brick: 'Brick',
    fern: 'Fern',
    plum: 'Plum',
    amber: 'Amber',
    walnut: 'Walnut',
    none: 'No color',
  },
} as const;
