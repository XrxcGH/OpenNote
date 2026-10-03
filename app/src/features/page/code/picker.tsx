// Opens the code language picker for a code block (owner: WP6). The code block's language button and the
// "Set code language" command both land here. It loads with the picker, on first use.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorHost } from '../../../editor/host';
import { applyLanguage } from '../../../editor/extensions/codeBlock';
import type { LanguagePickRequest } from '../../../editor/highlight/picker';
import { LanguagePicker } from './LanguagePicker';

let closeOpen: (() => void) | null = null;

export function openLanguagePicker(request: LanguagePickRequest, host: Pick<EditorHost, 'announce'>): void {
  closeOpen?.();
  const { view, pos, anchor, language } = request;
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    closeOpen = null;
    // The popover gives focus back to its control first; the caret's editor takes it after.
    setTimeout(() => {
      root.unmount();
      container.remove();
      if (!view.isDestroyed) view.focus();
    }, 0);
  };
  closeOpen = close;
  root.render(
    createElement(LanguagePicker, {
      anchor: { current: anchor },
      current: language,
      onClose: close,
      onPick(chosen: string | null) {
        close();
        if (!view.isDestroyed) applyLanguage(view, pos, chosen, host);
      },
    }),
  );
}
