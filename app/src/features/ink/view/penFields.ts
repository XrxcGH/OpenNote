// Writing in text fields with the pen (flag ink.penFields): where a pen touches the search box, a rename field, or a table
// cell, the system's handwriting panel opens, so the pen writes where a keyboard would type. The panel is the operating
// system's own (WebView2 hands the field to Windows' text input service), and the page only has to ask for it: it takes
// the keyboard policy of the field into its own hands and calls the virtual keyboard's show() once the pen's tap has
// focused the field. Fingers and the mouse are left alone. The setting is kept in this device's ink prefs, because it
// depends on this device's digitizer. Whether the panel appears is the system's to say; the owner checks it on a pen.

/** The parts of `navigator.virtualKeyboard` this uses. */
export interface VirtualKeyboardLike {
  show(): void;
}

/** The fields a pen may write in: the search box, rename fields, and the cells of a table in a page. */
export const PEN_FIELD_SELECTOR = [
  'input[type="search"]',
  '[data-pen-field]',
  '.ProseMirror td',
  '.ProseMirror th',
  '[role="gridcell"]',
].join(', ');

export interface PenFieldsOptions {
  readonly enabled: () => boolean;
  readonly keyboard: () => VirtualKeyboardLike | undefined;
  /** Waits until the field has focus. The default is the next task. */
  readonly later?: (run: () => void) => void;
}

/** The element that takes the text for a touch on a field: the input itself, or the editor around a cell. */
export function editableOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const field = target.closest(PEN_FIELD_SELECTOR);
  if (!field) return null;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field;
  return field.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])') ?? (field as HTMLElement);
}

/** Opens the handwriting panel when the pen touches a text field. Returns the function that stops it. */
export function installPenFields(doc: Document, options: PenFieldsOptions): () => void {
  const later = options.later ?? ((run: () => void) => void setTimeout(run, 0));
  const onDown = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== 'pen' || !options.enabled()) return;
    const editable = editableOf(pointer.target);
    const keyboard = options.keyboard();
    if (!editable || !keyboard) return;
    // With the policy on manual the system does not guess; the panel shows when the page says so.
    editable.setAttribute('virtualkeyboardpolicy', 'manual');
    later(() => {
      if (doc.activeElement === editable || editable.contains(doc.activeElement)) keyboard.show();
    });
  };
  doc.addEventListener('pointerdown', onDown, true);
  return () => doc.removeEventListener('pointerdown', onDown, true);
}

/** `navigator.virtualKeyboard`, where the browser has one. */
export function systemKeyboard(): VirtualKeyboardLike | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
}
