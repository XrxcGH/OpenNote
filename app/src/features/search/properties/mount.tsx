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
    const top = Math.max(rect.top, 0) + 8;
    host.style.insetBlockStart = `${top}px`;
    host.style.setProperty('--host-top', `${top}px`);
    const inset = Math.max(window.innerWidth - rect.right, 0) + 16;
    host.style.insetInlineEnd = `${inset}px`;
    // Never wider than the page area, so the chip and its panel stay inside it however narrow the page gets.
    host.style.maxInlineSize = `${Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0) - 32)}px`;
  };
  place();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
  observer?.observe(viewport);
  window.addEventListener('resize', place);
  const root = createRoot(host);
  root.render(<PropertiesBar page={mounted.page} />);
  return () => {
    window.removeEventListener('resize', place);
    observer?.disconnect();
    // The page view destroys its hooks while React may be mid-render, which a root cannot unmount in.
    setTimeout(() => root.unmount(), 0);
    host.remove();
  };
}
