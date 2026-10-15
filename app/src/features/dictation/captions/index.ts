// Live captions' public face. The strip mounts its own root, so nothing here costs anything at start-up.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptionStrip } from './CaptionStrip';

export { default as CaptionsSwitch } from './CaptionsSwitch';
export { captionChoices, captionWords, captionsOpen, loadCaptionChoices } from './store';
export { startCaptions, stopCaptions } from './session';

let root: ReturnType<typeof createRoot> | null = null;

/** Puts the caption strip on the page, once. It shows only while captions are running. */
export function mountCaptionStrip(): void {
  if (root) return;
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  root.render(createElement(CaptionStrip));
}
