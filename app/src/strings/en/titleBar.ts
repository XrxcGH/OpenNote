// The title bar: the breadcrumb, the overflow menu, window commands, and window titles.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const titleBar = {
  commands: {
    minimize: 'Minimize the window',
    toggleMaximize: 'Maximize or restore the window',
    close: 'Close OpenNote',
    systemMenu: 'Open the window menu',
  },
  breadcrumb: {
    label: 'Current location',
    shortened: 'Earlier levels',
  },
  more: 'More',
  windowTitle: {
    app: 'OpenNote',
    page: '{title} - OpenNote',
    settings: 'Settings - OpenNote',
    trash: 'Trash - OpenNote',
    setup: 'Set up OpenNote',
  },
} as const;
