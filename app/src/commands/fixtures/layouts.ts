// Keyboard layout fixtures for the dispatcher (ARCHITECTURE.md section 22.3; spike S7; owner: WP4). Each entry is a
// key press as WebView2 on Windows reports it on that layout: the typed key, the physical code, the modifiers, and
// the AltGraph state. Windows reports AltGr, and Ctrl+Alt on European layouts, as Ctrl and Alt with AltGraph on.
//
// `expect` is the command the press runs in a text box, or null when it types text. spikes/phase4/s7-keyboard-
// layouts has the page that records these and the manual checks that confirm them on real keyboards.

export type LayoutName = 'US' | 'Polish (Programmers)' | 'German' | 'French (AZERTY)';

export interface LayoutPress {
  layout: LayoutName;
  /** What the person pressed, as the keycaps read. */
  pressed: string;
  key: string;
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  altGraph?: boolean;
  /** The shortcut set the press is in; the default set when absent. */
  preset?: 'default' | 'onenote';
  expect: string | null;
}

export const LAYOUT_PRESSES: readonly LayoutPress[] = [
  // US: Ctrl+Alt chords are shortcuts, and Shift chords on digits match by their physical key.
  { layout: 'US', pressed: 'Ctrl+Alt+2', key: '2', code: 'Digit2', ctrl: true, alt: true, expect: 'block.heading2' },
  { layout: 'US', pressed: 'Ctrl+B', key: 'b', code: 'KeyB', ctrl: true, expect: 'format.bold' },
  {
    layout: 'US',
    pressed: 'Ctrl+Shift+7',
    key: '&',
    code: 'Digit7',
    ctrl: true,
    shift: true,
    expect: 'block.orderedList',
  },
  { layout: 'US', pressed: 'Ctrl+Shift+.', key: '>', code: 'Period', ctrl: true, shift: true, expect: 'format.larger' },
  {
    layout: 'US',
    pressed: 'Ctrl+Alt+H',
    key: 'h',
    code: 'KeyH',
    ctrl: true,
    alt: true,
    preset: 'onenote',
    expect: 'format.highlight',
  },
  // Polish (Programmers): AltGr letters are text, never Ctrl+Alt shortcuts.
  { layout: 'Polish (Programmers)', pressed: 'AltGr+C', key: 'ć', code: 'KeyC', altGraph: true, expect: null },
  { layout: 'Polish (Programmers)', pressed: 'AltGr+A', key: 'ą', code: 'KeyA', altGraph: true, expect: null },
  { layout: 'Polish (Programmers)', pressed: 'AltGr+L', key: 'ł', code: 'KeyL', altGraph: true, expect: null },
  {
    layout: 'Polish (Programmers)',
    pressed: 'AltGr+Shift+S',
    key: 'Ś',
    code: 'KeyS',
    shift: true,
    altGraph: true,
    expect: null,
  },
  { layout: 'Polish (Programmers)', pressed: 'Ctrl+B', key: 'b', code: 'KeyB', ctrl: true, expect: 'format.bold' },
  {
    layout: 'Polish (Programmers)',
    pressed: 'AltGr+H',
    key: 'h',
    code: 'KeyH',
    altGraph: true,
    preset: 'onenote',
    expect: 'format.highlight',
  },
  // German: AltGr+2 and AltGr+3 type ² and ³, so Heading 2 and 3 lose their keys there. Ctrl+Shift+7 types /,
  // and the exact key beats the physical one.
  { layout: 'German', pressed: 'AltGr+2', key: '²', code: 'Digit2', altGraph: true, expect: null },
  { layout: 'German', pressed: 'AltGr+3', key: '³', code: 'Digit3', altGraph: true, expect: null },
  { layout: 'German', pressed: 'AltGr+Q', key: '@', code: 'KeyQ', altGraph: true, expect: null },
  { layout: 'German', pressed: 'AltGr+E', key: '€', code: 'KeyE', altGraph: true, expect: null },
  {
    layout: 'German',
    pressed: 'Ctrl+Shift+7',
    key: '/',
    code: 'Digit7',
    ctrl: true,
    shift: true,
    expect: 'app.shortcuts',
  },
  // Ctrl+Z stays with the text box, whose keymap sends it to the page's undo by its letter.
  { layout: 'German', pressed: 'Ctrl+Z', key: 'z', code: 'KeyY', ctrl: true, expect: null },
  // French (AZERTY): digits need Shift, so Ctrl+& is the 1 key; AltGr+é is a dead tilde.
  { layout: 'French (AZERTY)', pressed: 'AltGr+é', key: 'Dead', code: 'Digit2', altGraph: true, expect: null },
  { layout: 'French (AZERTY)', pressed: 'AltGr+E', key: '€', code: 'KeyE', altGraph: true, expect: null },
  { layout: 'French (AZERTY)', pressed: 'Ctrl+&', key: '&', code: 'Digit1', ctrl: true, expect: null },
  { layout: 'French (AZERTY)', pressed: 'Ctrl+B', key: 'b', code: 'KeyB', ctrl: true, expect: 'format.bold' },
];
