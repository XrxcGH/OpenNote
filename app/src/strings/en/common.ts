// Shared words: the app name, the notifications region, common buttons, and the primitives' own text.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const common = {
  appName: 'OpenNote',
  cancel: 'Cancel',
  close: 'Close',
  notifications: 'Notifications',
  editMenu: 'Edit',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  /** A tooltip: a control's name with its shortcut, such as "Dark mode (Ctrl+Shift+D)". */
  tooltip: '{label} ({shortcut})',
} as const;
