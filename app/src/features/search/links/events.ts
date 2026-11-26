// The page link commands reach the editor that has focus by an event on its element, so the commands (loaded at
// start-up) never import the editor code (loaded with the first page).
import type { CommandContext } from '../../../commands/types';

export const PAGE_LINK_EVENT = 'opennote:page-link';
export type PageLinkAction = 'follow' | 'preview' | 'start';

let lastEditor: Element | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (event) => {
      const editable = event.target instanceof Element ? event.target.closest('.ProseMirror') : null;
      if (editable) lastEditor = editable;
    },
    true,
  );
}

/**
 * The editor that has focus. When the palette or a bar button holds focus (the palette is open, or a ribbon command
 * ran), the editor focus was last in, so editor commands stay listed and run (Beta 8 walk A-A04-11).
 */
export function focusedEditor(): Element | null {
  const focused = document.activeElement;
  const editable = focused instanceof Element ? focused.closest('.ProseMirror') : null;
  if (editable) return editable;
  const away = !focused || focused === document.body || focused.closest('[data-scope~="palette"], [data-region]');
  return away && lastEditor?.isConnected ? lastEditor : null;
}

/** Runs a page link command on the editor that has focus. Returns false when no editor does. */
export function runPageLinkCommand(action: PageLinkAction): boolean {
  const editable = focusedEditor();
  if (!editable) return false;
  editable.dispatchEvent(new CustomEvent<PageLinkAction>(PAGE_LINK_EVENT, { detail: action }));
  return true;
}

/** Whether an editor has focus, or had it before the palette opened, for the commands' `when`. */
export function editorHasFocus(ctx?: CommandContext): boolean {
  const focused = document.activeElement;
  if (focused instanceof Element && focused.closest('.ProseMirror') !== null) return true;
  if (ctx?.source === 'palette') return ctx.focusZone === 'textInput' && focusedEditor() !== null;
  return false;
}
