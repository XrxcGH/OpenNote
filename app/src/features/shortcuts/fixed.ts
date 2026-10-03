// The keys that always work (ARCHITECTURE.md section 14.7): the navigation keys that reserved.ts keeps free, and
// Alt+Space. Phase 4 adds the keys of text boxes and selected boxes (AMENDMENTS.md P2-12).

import type { MessageKey } from '../../strings/t';

export interface FixedKeyRow {
  readonly id: string;
  /** Chords in the canonical form, or a message for keys that aren't one, such as type-ahead letters. */
  readonly keys: readonly string[] | MessageKey;
  readonly action: MessageKey;
}

export const FIXED_KEYS: readonly FixedKeyRow[] = [
  { id: 'arrows', keys: ['Up', 'Down', 'Left', 'Right'], action: 'shortcuts.fixed.arrows' },
  { id: 'startEnd', keys: ['Home', 'End'], action: 'shortcuts.fixed.startEnd' },
  { id: 'typeahead', keys: 'shortcuts.fixed.letters', action: 'shortcuts.fixed.typeahead' },
  { id: 'tab', keys: ['Tab', 'Shift+Tab'], action: 'shortcuts.fixed.tab' },
  { id: 'enter', keys: ['Enter', 'Space'], action: 'shortcuts.fixed.enter' },
  { id: 'regions', keys: ['F6', 'Shift+F6'], action: 'shortcuts.fixed.regions' },
  { id: 'menu', keys: ['Shift+F10', 'Menu'], action: 'shortcuts.fixed.menu' },
  { id: 'escape', keys: ['Escape'], action: 'shortcuts.fixed.escape' },
  { id: 'windowMenu', keys: ['Alt+Space'], action: 'shortcuts.fixed.windowMenu' },
  { id: 'editorTab', keys: ['Tab', 'Shift+Tab'], action: 'shortcuts.fixed.editorTab' },
  { id: 'editorEscape', keys: ['Escape'], action: 'shortcuts.fixed.editorEscape' },
  { id: 'editorEnter', keys: ['Enter', 'Shift+Enter'], action: 'shortcuts.fixed.editorEnter' },
  { id: 'editorEdges', keys: ['Backspace', 'Delete'], action: 'shortcuts.fixed.editorEdges' },
  { id: 'editorSelectAll', keys: ['Ctrl+A'], action: 'shortcuts.fixed.editorSelectAll' },
  { id: 'editorClipboard', keys: ['Ctrl+C', 'Ctrl+X', 'Ctrl+V'], action: 'shortcuts.fixed.editorClipboard' },
  { id: 'editorPastePlain', keys: ['Ctrl+Shift+V'], action: 'shortcuts.fixed.editorPastePlain' },
  { id: 'editorSlash', keys: 'shortcuts.fixed.slashKey', action: 'shortcuts.fixed.editorSlash' },
  { id: 'objectMove', keys: ['Up', 'Down', 'Left', 'Right'], action: 'shortcuts.fixed.objectMove' },
  {
    id: 'objectResize',
    keys: ['Shift+Up', 'Shift+Down', 'Shift+Left', 'Shift+Right'],
    action: 'shortcuts.fixed.objectResize',
  },
  { id: 'objectToggle', keys: ['Space'], action: 'shortcuts.fixed.objectToggle' },
  { id: 'objectEdit', keys: ['Enter', 'F2'], action: 'shortcuts.fixed.objectEdit' },
];
