// Puts the properties header on the page that is shown. It floats at the top end of the page area, outside the page's
// own layout, so a page's text never moves for it. The page view calls this once for each page it mounts.
import { createRoot } from 'react-dom/client';
import type { MountedPage } from '../../page';
import { PropertiesBar } from './PropertiesBar';
import styles from './properties.module.css';

let measure: CanvasRenderingContext2D | null | undefined;

/** The width in screen px of the title's longest word, which no line break can make narrower. */
function longestWord(title: Element): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return 0;
  const style = getComputedStyle(title);
  measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const box = title.getBoundingClientRect();
  const scale = title instanceof HTMLElement && title.offsetWidth > 0 ? box.width / title.offsetWidth : 1;
  const words = (title.textContent ?? '').split(/\s+/);
  return Math.max(0, ...words.map((word) => measure!.measureText(word).width)) * scale;
}

export function mountProperties(mounted: MountedPage): () => void {
  const host = document.createElement('div');
  host.className = styles.host;
  host.dataset.region = 'page-properties';
  document.body.append(host);
  const viewport = mounted.viewport.viewport;
  const place = () => {
    const rect = viewport.getBoundingClientRect();
    // The page area's right edge inside its scroll bar, so the chip never sits on the bar or past it.
    let right = Math.min(rect.left + viewport.clientLeft + viewport.clientWidth, window.innerWidth);
    // A pane that opens over the page as a drawer (Reading order, Contents) takes the page's end edge: the chip
    // stays left of it.
    for (const pane of document.querySelectorAll('[data-page-pane]')) {
      const box = pane.getBoundingClientRect();
      if (box.width > 0 && box.left < right && box.right > rect.left) right = Math.max(rect.left, box.left);
    }
    const top = Math.max(rect.top, 0) + 8;
    host.style.insetBlockStart = `${top}px`;
    host.style.setProperty('--host-top', `${top}px`);
    const inset = window.innerWidth - right + 16;
    host.style.insetInlineEnd = `${inset}px`;
    // Never wider than the page area, so the chip and its panel stay inside it however narrow the page gets.
    host.style.maxInlineSize = `${Math.max(0, right - Math.max(rect.left, 0) - 32)}px`;
    // The title wraps before it reaches the chip: the chip's width, its 16 px inset, and an 8 px gap. A single word
    // that is wider than that room runs on under the chip, so the chip then takes a line of its own above the title,
    // and the title keeps the full width.
    const box = host.querySelector('button')?.getBoundingClientRect();
    const chip = box?.width ?? 0;
    const title = viewport.querySelector('[data-page-title]');
    const crowded =
      chip > 0 && !!box && !!title && title.getBoundingClientRect().left + longestWord(title) > box.left - 4;
    viewport.style.setProperty('--page-chip-room', `${chip && !crowded ? Math.ceil(chip) + 24 : 0}px`);
    viewport.style.setProperty('--page-chip-drop', `${box && crowded ? Math.ceil(box.height) + 16 : 0}px`);
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
  // A longer word typed into the title can reach the chip.
  const onInput = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('[data-page-title]')) placeLater();
  };
  viewport.addEventListener('input', onInput);
  // A pane opening or closing beside the page changes its siblings, not the page's own size.
  const panes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(placeLater);
  // The page's ancestors gain or lose a child (never watching their subtrees, so typing does not wake it).
  let up: Element | null = viewport.parentElement;
  for (let level = 0; up && level < 8; level += 1, up = up.parentElement) panes?.observe(up, { childList: true });
  const root = createRoot(host);
  root.render(<PropertiesBar page={mounted.page} />);
  return () => {
    window.removeEventListener('resize', placeLater);
    viewport.removeEventListener('input', onInput);
    cancelAnimationFrame(frame);
    observer?.disconnect();
    panes?.disconnect();
    // The page view destroys its hooks while React may be mid-render, which a root cannot unmount in.
    setTimeout(() => root.unmount(), 0);
    host.remove();
    viewport.style.removeProperty('--page-chip-room');
    viewport.style.removeProperty('--page-chip-drop');
  };
}
