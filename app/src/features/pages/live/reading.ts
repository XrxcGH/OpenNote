// Reading aids on the page view: a tint, wider spacing, a shorter line, and the focus band that lights the lines being
// read. They are a setting of this device and change only how the page looks. They never reach the note, and the print
// document does not use them. The setting lives in this browser's storage, which is this device.
import { createStore } from '../../../state/store';
import type { MountedPage } from '../../page';
import {
  DEFAULT_READING,
  dimmedAreas,
  focusBand,
  isActive,
  lineAtY,
  readReading,
  readingStyle,
  writeReading,
} from '../reading';
import type { LineBox, ReadingAids } from '../reading';
import { linesOf } from '../print/dom';
import styles from './live.module.css';

const KEY = 'opennote.readingAids';

function load(): ReadingAids {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? readReading(JSON.parse(raw)).aids : DEFAULT_READING;
  } catch {
    return DEFAULT_READING;
  }
}

/** The reading aids of this device. */
export const readingAids = createStore<ReadingAids>(load(), 'reading aids');

export function setReadingAids(next: ReadingAids): void {
  readingAids.set(next);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(writeReading(next)));
  } catch {
    // The setting lasts until the window closes.
  }
}

const VARS = ['--reading-page', '--reading-word-space', '--reading-paragraph-space', '--reading-measure'] as const;
const STYLE_ID = 'opennote-reading-style';

/** Rules for the page's text, and for the sheets when the page is on paper. */
function css(aids: ReadingAids): string {
  const extra = [
    '.reading-sheets > div { background: var(--reading-page) !important; }',
    '.reading-text [data-block] > * + * { margin-block-start: var(--reading-paragraph-space, 0); }',
  ];
  return `${readingStyle(aids).css}\n${extra.join('\n')}`;
}

/** Lines of every text block, sorted from the top, in page units. */
function pageLines(mounted: MountedPage): LineBox[] {
  const { viewport, layer, pool } = mounted;
  const zoom = viewport.camera().zoom;
  const origin = viewport.world.getBoundingClientRect();
  const lines: LineBox[] = [];
  for (const block of layer.blocks()) {
    const root =
      block.type === 'text' ? layer.view(block.id)?.element.querySelector<HTMLElement>('[data-block]') : null;
    if (!root) continue;
    const editor = pool.editor(block.id);
    const elements: Element[] = [];
    if (editor && !editor.isDestroyed) {
      editor.state.doc.forEach((_node, offset) => {
        const dom = editor.view.nodeDOM(offset);
        if (dom instanceof Element) elements.push(dom);
      });
    } else elements.push(...root.children);
    for (const element of elements) {
      if (element.matches('[data-pg-spacer]')) continue;
      for (const box of linesOf(element, origin).boxes) lines.push({ top: box.top / zoom, height: box.height / zoom });
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** Applies the aids to a mounted page and keeps the focus band following the reader. Returns a function that undoes it. */
export function attachReading(mounted: MountedPage, paginated: () => boolean): { refresh(): void; stop(): void } {
  const { world } = mounted.viewport;
  const doc = world.ownerDocument;
  const band = doc.createElement('div');
  band.className = styles.focusLayer;
  band.setAttribute('aria-hidden', 'true');
  const above = band.appendChild(doc.createElement('div'));
  const below = band.appendChild(doc.createElement('div'));
  above.className = below.className = styles.dim;
  world.append(band);
  let lines: LineBox[] | null = null;
  let active = -1;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const aids = readingAids.get();
    lines ??= pageLines(mounted);
    const focus = active >= 0 ? focusBand(lines, active, aids.focus) : null;
    band.hidden = focus === null;
    if (!focus) return;
    const area = { x: 0, y: 0, w: world.offsetWidth, h: world.offsetHeight };
    const [top, bottom] = dimmedAreas(focus, area);
    for (const [element, rect] of [
      [above, top],
      [below, bottom],
    ] as const) {
      element.hidden = rect === null;
      if (!rect) continue;
      element.style.insetBlockStart = `${rect.y}px`;
      element.style.blockSize = `${rect.h}px`;
      element.style.inlineSize = `${rect.w}px`;
    }
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(draw);
  };

  const apply = () => {
    const aids = readingAids.get();
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.append(style);
    }
    style.textContent = css(aids);
    const { vars } = readingStyle(aids);
    for (const name of VARS) {
      if (name in vars) world.style.setProperty(name, vars[name]);
      else world.style.removeProperty(name);
    }
    const tinted = '--reading-page' in vars;
    world.classList.toggle('reading-page', tinted && !paginated());
    mounted.viewport.world
      .querySelector(`.${styles.sheets}`)
      ?.classList.toggle('reading-sheets', tinted && paginated());
    mounted.flow.element.classList.toggle('reading-text', isActive(aids));
    lines = null;
    schedule();
  };

  const onPointer = (event: PointerEvent) => {
    if (readingAids.get().focus === 0) return;
    lines ??= pageLines(mounted);
    active = lineAtY(lines, mounted.viewport.toWorld(event.clientX, event.clientY).y);
    schedule();
  };
  const onSelection = () => {
    if (readingAids.get().focus === 0) return;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || !world.contains(selection.anchorNode)) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.height === 0 && rect.top === 0) return;
    lines ??= pageLines(mounted);
    active = lineAtY(lines, mounted.viewport.toWorld(rect.left, rect.top + rect.height / 2).y);
    schedule();
  };
  const onLayout = () => {
    lines = null;
    if (readingAids.get().focus !== 0) schedule();
  };

  const host = mounted.viewport.viewport;
  host.addEventListener('pointermove', onPointer, { passive: true });
  doc.addEventListener('selectionchange', onSelection);
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onLayout);
  mutations?.observe(mounted.flow.element, { childList: true, subtree: true, characterData: true });
  const stopAids = readingAids.subscribe(apply);
  apply();

  return {
    refresh: apply,
    stop() {
      stopAids();
      host.removeEventListener('pointermove', onPointer);
      doc.removeEventListener('selectionchange', onSelection);
      mutations?.disconnect();
      cancelAnimationFrame(frame);
      band.remove();
      world.classList.remove('reading-page');
      mounted.flow.element.classList.remove('reading-text');
      for (const name of VARS) world.style.removeProperty(name);
    },
  };
}
