// The page's title band outside the world (owner WP3). The page view keeps one band element for as long as it
// shows pages: it sits here while a page loads, the world adopts it when the page opens, and it comes back here
// when the page closes. So the heading the tree's Enter focused is the element the person types the title into,
// and focus never drops while pages switch.
import { useLayoutEffect, useRef, useState } from 'react';
import styles from './title.module.css';

const slots = new WeakMap<HTMLElement, HTMLElement>();
const latest = new WeakMap<HTMLElement, { title: string; changed: string | null }>();

function show(band: HTMLElement, title: string, changed: string | null): void {
  const heading = band.querySelector('h1');
  if (heading) heading.textContent = title;
  let line = band.querySelector('p');
  if (changed && !line) {
    line = document.createElement('p');
    line.className = styles.changed;
    band.append(line);
  }
  if (line && changed) line.textContent = changed;
  else line?.remove();
}

/** The band: a heading and the changed line. The page view adds the title's textbox when it adopts it. */
export function useTitleBand(): HTMLElement {
  const [band] = useState(() => {
    const element = document.createElement('div');
    element.className = styles.band;
    const heading = document.createElement('h1');
    heading.className = styles.title;
    heading.tabIndex = -1;
    heading.dataset.pageTitle = '';
    element.append(heading);
    return element;
  });
  return band;
}

/** Puts an adopted band back in its slot, with the latest page's title, keeping focus on its heading. */
export function returnBand(band: HTMLElement): void {
  const slot = slots.get(band);
  if (!slot || band.parentElement === slot) return;
  const focused = band.contains(band.ownerDocument.activeElement);
  const shown = latest.get(band);
  if (shown) show(band, shown.title, shown.changed);
  slot.append(band);
  if (focused) band.querySelector('h1')?.focus({ preventScroll: true });
}

/** Shows the band while no page holds it. */
export function TitleSlot({ band, title, changed }: { band: HTMLElement; title: string; changed: string | null }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = slot.current!;
    slots.set(band, element);
    if (!band.isConnected) element.append(band);
    return () => {
      if (band.parentElement === element) band.remove();
    };
  }, [band]);
  useLayoutEffect(() => {
    latest.set(band, { title, changed });
    if (band.parentElement === slot.current) show(band, title, changed);
  }, [band, title, changed]);
  return <div ref={slot} />;
}
