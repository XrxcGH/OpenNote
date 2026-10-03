// Key names in shortcuts, such as "Ctrl" and "Delete", so shortcuts can be translated.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const keys = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageUp: 'Page Up',
  pageDown: 'Page Down',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  insert: 'Insert',
  menu: 'Menu',
  plus: 'Plus',
} as const;
