// Opens the From phone dialog over the app, once at a time, and puts focus back where it was when it closes.
import { createRoot } from 'react-dom/client';
import { shownMounted } from '../../page';
import { PhoneDialog } from './PhoneDialog';

let current: (() => void) | null = null;

/** Where photos go: the open page, when it can change. */
function pasteTarget(): EventTarget | null {
  const mounted = shownMounted.get();
  if (!mounted || mounted.page.readOnly) return null;
  return mounted.pool.active()?.editor.view.dom ?? mounted.viewport.sizer;
}

export function openPhoneDialog(): void {
  if (current) return;
  const element = document.body.appendChild(document.createElement('div'));
  const root = createRoot(element);
  current = () => {
    current = null;
    root.unmount();
    element.remove();
  };
  root.render(<PhoneDialog onClose={() => current?.()} pasteTarget={pasteTarget} />);
}
