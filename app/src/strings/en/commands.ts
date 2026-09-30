// Command titles and palette keywords for the app commands, the command bar, and the bottom bar.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const commands = {
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
