// Puts the properties header on the page that is shown. It floats at the top end of the page area, outside the page's
// own layout, so a page's text never moves for it. The page view calls this once for each page it mounts.
import { createRoot } from 'react-dom/client';
import type { MountedPage } from '../../page';
import { PropertiesBar } from './PropertiesBar';
import styles from './properties.module.css';

export function mountProperties(mounted: MountedPage): () => void {
  const host = document.createElement('div');
  host.className = styles.host;
  host.dataset.region = 'page-properties';
  document.body.append(host);
  const viewport = mounted.viewport.viewport;
  const place = () => {
    const rect = viewport.getBoundingClientRect();
    // The page area's right edge inside its scroll bar, so the chip never sits on the bar or past it.
    const right = Math.min(rect.left + viewport.clientLeft + viewport.clientWidth, window.innerWidth);
    const top = Math.max(rect.top, 0) + 8;
    host.style.insetBlockStart = `${top}px`;
    host.style.setProperty('--host-top', `${top}px`);
    const inset = window.innerWidth - right + 16;
    host.style.insetInlineEnd = `${inset}px`;
    // Never wider than the page area, so the chip and its panel stay inside it however narrow the page gets.
    host.style.maxInlineSize = `${Math.max(0, right - Math.max(rect.left, 0) - 32)}px`;
    // The title wraps before it reaches the chip: the chip's width, its 16 px inset, and an 8 px gap.
    const chip = host.querySelector('button')?.getBoundingClientRect().width ?? 0;
    viewport.style.setProperty('--page-chip-room', `${chip ? Math.ceil(chip) + 24 : 0}px`);
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
  const root = createRoot(host);
  root.render(<PropertiesBar page={mounted.page} />);
  return () => {
    window.removeEventListener('resize', placeLater);
    cancelAnimationFrame(frame);
    observer?.disconnect();
    // The page view destroys its hooks while React may be mid-render, which a root cannot unmount in.
    setTimeout(() => root.unmount(), 0);
    host.remove();
    viewport.style.removeProperty('--page-chip-room');
  };
}
