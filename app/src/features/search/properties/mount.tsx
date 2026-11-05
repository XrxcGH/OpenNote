// Puts the properties header on the page that is shown. It floats at the top end of the page area, outside the page's
// own layout, so a page's text never moves for it. The page view calls this once for each page it mounts.
import { createRoot } from 'react-dom/client';
import type { MountedPage } from '../../page';
import { PropertiesBar } from './PropertiesBar';
import { CHIP_INSET, chipLimit } from './placement';
import styles from './properties.module.css';

export function mountProperties(mounted: MountedPage): () => void {
  const host = document.createElement('div');
  host.className = styles.host;
  host.dataset.region = 'page-properties';
  // Ctrl+Z in the panel undoes the page's steps, its own edits among them (page/registrations/sync.ts).
  host.dataset.pageUndo = '';
  document.body.append(host);
  const viewport = mounted.viewport.viewport;
  const place = () => {
    const rect = viewport.getBoundingClientRect();
    // The page area's right edge inside its scroll bar, left of a pane that opens over the page, and inside the window.
    const panes = [...document.querySelectorAll('[data-page-pane]')].map((pane) => pane.getBoundingClientRect());
    const chipWidth = host.querySelector('button')?.getBoundingClientRect().width ?? 0;
    const right = chipLimit({
      left: rect.left,
      right: rect.left + viewport.clientLeft + viewport.clientWidth,
      panes,
      windowWidth: window.innerWidth,
      chip: chipWidth,
    });
    const top = Math.max(rect.top, 0) + 8;
    host.style.insetBlockStart = `${top}px`;
    host.style.setProperty('--host-top', `${top}px`);
    const inset = window.innerWidth - right + CHIP_INSET;
    host.style.insetInlineEnd = `${inset}px`;
    // Never wider than the page area, so the chip and its panel stay inside it however narrow the page gets.
    host.style.maxInlineSize = `${Math.max(0, right - Math.max(rect.left, 0) - 2 * CHIP_INSET)}px`;
    // The title wraps before it reaches the chip: the chip's width, its 16 px inset, and an 8 px gap.
    viewport.style.setProperty('--page-chip-room', `${chipWidth ? Math.ceil(chipWidth) + 24 : 0}px`);
  };
  place();
  // Placing the chip resizes the host and the title room, which the observer watches: placing from inside its callback
  // makes the browser report a "ResizeObserver loop" error. The next animation frame is still before paint.
  let frame = 0;
  const placeLater = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(placeLater);
  observer?.observe(viewport);
  observer?.observe(host);
  window.addEventListener('resize', placeLater);
  // A pane opening or closing beside the page changes its siblings, not the page's own size.
  const panes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(placeLater);
  // The page's ancestors gain or lose a child (never watching their subtrees, so typing does not wake it).
  let up: Element | null = viewport.parentElement;
  for (let level = 0; up && level < 8; level += 1, up = up.parentElement) panes?.observe(up, { childList: true });
  const root = createRoot(host);
  root.render(<PropertiesBar page={mounted.page} sync={mounted.sync} />);
  return () => {
    window.removeEventListener('resize', placeLater);
    cancelAnimationFrame(frame);
    observer?.disconnect();
    panes?.disconnect();
    // The page view destroys its hooks while React may be mid-render, which a root cannot unmount in.
    setTimeout(() => root.unmount(), 0);
    host.remove();
    viewport.style.removeProperty('--page-chip-room');
  };
}
