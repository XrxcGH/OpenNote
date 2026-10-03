// The keys that always work (ARCHITECTURE.md section 14.7): the navigation keys that reserved.ts keeps free, and
// Alt+Space. Later phases add their editor and object keys here (AMENDMENTS.md P2-12).

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
];
