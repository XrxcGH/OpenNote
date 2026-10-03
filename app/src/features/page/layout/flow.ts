// The flow column and the world's size (ARCHITECTURE.md sections 5.1 and 6.2; owner WP3). Every block wrapper sits
// in the flow column, in reading order. Flowing blocks stack there, and floating ones sit at their frames in the
// world, because the column isn't positioned. The world grows to fit the content and never shrinks.
import type { PageViewJson } from '../../../services/pages/types';
import { fitWidthZoom } from '../viewport/camera';
import { observeResize } from '../viewport/viewport';
import type { PageViewport } from '../viewport/viewport';
import styles from './layout.module.css';

export interface Flow {
  readonly element: HTMLElement;
  /** Applies the page's layout fields: its content width and freeform or flow. */
  setView(view: PageViewJson): void;
  /** The compact Reading view: one column in reading order, frames ignored. */
  setReading(on: boolean): void;
  /** The zoom that fits the widest content, at least the flow column, to the viewport's width. */
  fitWidth(): number;
  stop(): void;
}

/** The right and bottom edges of everything in the world, in page units. */
function contentExtent(world: HTMLElement, flow: HTMLElement): { w: number; h: number } {
  let w = flow.offsetLeft + flow.offsetWidth;
  let h = flow.offsetTop + flow.offsetHeight;
  for (const child of flow.children) {
    if (!(child instanceof HTMLElement)) continue;
    w = Math.max(w, child.offsetLeft + child.offsetWidth);
    h = Math.max(h, child.offsetTop + child.offsetHeight);
  }
  for (const child of world.children) {
    if (child instanceof HTMLElement && child !== flow) h = Math.max(h, child.offsetTop + child.offsetHeight);
  }
  return { w, h };
}

export function createFlow(viewport: PageViewport): Flow {
  const flow = viewport.world.ownerDocument.createElement('div');
  flow.className = styles.flow;
  viewport.world.append(flow);
  let frame = 0;
  // The world grows in the next frame: growing it from the observer would make the observer loop.
  const grow = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      viewport.setContent(contentExtent(viewport.world, flow));
    });
  };
  const stopFlow = observeResize(flow, grow);
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(grow);
  mutations?.observe(flow, { childList: true, attributes: true, attributeFilter: ['style'], subtree: false });
  return {
    element: flow,
    setView(view) {
      const width = typeof view.contentWidth === 'number' && view.contentWidth > 0 ? view.contentWidth : null;
      if (width) flow.style.setProperty('--flow-width', `${width}px`);
      else flow.style.removeProperty('--flow-width');
      flow.dataset.layout = view.layout === 'flow' ? 'flow' : 'freeform';
    },
    setReading(on) {
      if (on) viewport.world.dataset.layout = 'reading';
      else delete viewport.world.dataset.layout;
      flow.classList.toggle(styles.reading, on);
    },
    fitWidth() {
      const { w } = contentExtent(viewport.world, flow);
      return fitWidthZoom(w + flow.offsetLeft, viewport.camera().viewport.w);
    },
    stop() {
      stopFlow();
      mutations?.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
