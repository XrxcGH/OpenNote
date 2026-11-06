// Focus the app moves by script, such as a dialog's first control, shows no focus ring after a pointer or before any
// input (docs/BRAND.md section 12). The ring comes back with the next Tab, arrow key, or Escape. Focus that follows
// a key press always shows the ring, and so does focus that a person moves.

type InputKind = 'pointer' | 'key' | 'none';

let last: InputKind = 'none';
let listening = false;

const ATTRIBUTE = 'data-focus-origin';
/** Keys that bring the ring back on any element. */
const MOVES_ANYWHERE = new Set(['Tab', 'Escape']);
const MOVES_ON_CONTROLS = new Set([...MOVES_ANYWHERE, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** A text input, a textarea, or an editable region: arrow keys move the caret there, so they keep the ring hidden. */
function takesText(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'file', 'color'].includes(
      element.type,
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function note(kind: InputKind) {
  return () => {
    last = kind;
  };
}

function ensureListening() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('pointerdown', note('pointer'), true);
  document.addEventListener(
    'keydown',
    (event) => {
      last = 'key';
      const target = document.activeElement;
      if (!target?.hasAttribute(ATTRIBUTE)) return;
      const moves = takesText(target) ? MOVES_ANYWHERE : MOVES_ON_CONTROLS;
      if (moves.has(event.key)) target.removeAttribute(ATTRIBUTE);
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (event) => {
      if (event.target instanceof Element) event.target.removeAttribute(ATTRIBUTE);
    },
    true,
  );
}

ensureListening();

/**
 * Focuses the element for the app. When the last input was a pointer, or there was none yet, the element is marked so
 * its focus ring stays hidden until the person presses Tab, an arrow key, or Escape.
 */
export function focusFromScript(element: HTMLElement, options?: FocusOptions): void {
  ensureListening();
  if (last !== 'key') element.setAttribute(ATTRIBUTE, 'pointer');
  else element.removeAttribute(ATTRIBUTE);
  element.focus(options);
  // Focus that did not land (a hidden or inert element) leaves no mark, so a later Tab onto it shows the ring.
  if (document.activeElement !== element) element.removeAttribute(ATTRIBUTE);
}
