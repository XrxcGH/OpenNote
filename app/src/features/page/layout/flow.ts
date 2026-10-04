// The flow column and the world's size (ARCHITECTURE.md sections 5.1 and 6.2; owner WP3). Every block wrapper sits
// in the flow column, in reading order. Flowing blocks stack there, and floating ones sit at their frames in the
// world, because the column isn't positioned. The world grows to fit the content and never shrinks.
import type { PageViewJson } from '../../../services/pages/types';
import { fitWidthZoom } from '../viewport/camera';
import { observeResize } from '../viewport/viewport';
import type { PageViewport } from '../viewport/viewport';
import { RULE_PROPERTIES, fontMetric, leadFor, ruleProperties, wholeRules } from './rules';
import type { RuleGrid } from './rules';
import styles from './layout.module.css';

export interface Flow {
  readonly element: HTMLElement;
  /** Applies the page's layout fields: its content width and freeform or flow. */
  setView(view: PageViewJson): void;
  /** The compact Reading view: one column in reading order, frames ignored. */
  setReading(on: boolean): void;
  /** The zoom that fits the widest content, at least the flow column, to the viewport's width. */
  fitWidth(): number;
  /** Ruled paper: lays the page out in the paper's rule spacing (see rules.ts), or back to free layout with null. */
  setRules(grid: RuleGrid | null): void;
  /** The rules the page is laid out in, or null on plain paper. */
  rules(): RuleGrid | null;
  stop(): void;
}

/**
 * The right and bottom edges of everything in the world, in page units. An ink block's slot is an empty box the ink
 * view draws over, not content, so a page of text with handwriting on it still never scrolls sideways.
 */
function contentExtent(world: HTMLElement, flow: HTMLElement): { w: number; h: number; floating: boolean } {
  let w = flow.offsetLeft + flow.offsetWidth;
  let h = flow.offsetTop + flow.offsetHeight;
  let floating = false;
  for (const child of flow.children) {
    if (!(child instanceof HTMLElement) || child.dataset.ink !== undefined) continue;
    w = Math.max(w, child.offsetLeft + child.offsetWidth);
    h = Math.max(h, child.offsetTop + child.offsetHeight);
    floating ||= child.style.left !== '';
  }
  for (const child of world.children) {
    if (child instanceof HTMLElement && child !== flow) h = Math.max(h, child.offsetTop + child.offsetHeight);
  }
  return { w, h, floating };
}

export function createFlow(viewport: PageViewport): Flow {
  const flow = viewport.world.ownerDocument.createElement('div');
  flow.className = styles.flow;
  viewport.world.append(flow);
  let frame = 0;
  let lastWidth = 0;
  // The world grows in the next frame: growing it from the observer would make the observer loop. When the flow got
  // narrower (the window or a pane did), the world's width goes back down with it.
  const grow = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      // Sheets set their own width, which a narrower column does not change.
      const narrower = flow.offsetWidth < lastWidth && viewport.world.dataset.sheets === undefined;
      lastWidth = flow.offsetWidth;
      viewport.setContent({ ...contentExtent(viewport.world, flow), narrower });
    });
  };
  const stopFlow = observeResize(flow, grow);
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(grow);
  mutations?.observe(flow, { childList: true, attributes: true, attributeFilter: ['style'], subtree: false });
  const ruled = createRuleAligner(viewport, flow);
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
    setRules: ruled.set,
    rules: ruled.current,
    stop() {
      ruled.stop();
      stopFlow();
      mutations?.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

/** The blocks inside a text block that come in no particular height, and so are padded to whole rules. */
const PADDED_INSIDE = 'table, figure';

/**
 * Keeps the flow on the rules. The stylesheet puts text on the rules; this adds what CSS cannot know: the lead that
 * brings the flow's first line to a rule below the title, and the margin that rounds a table, an image, or any block
 * that does not come in whole rules up to one, so the text after it is back on a rule.
 */
function createRuleAligner(viewport: PageViewport, flow: HTMLElement) {
  const { world } = viewport;
  let grid: RuleGrid | null = null;
  let frame = 0;
  const watched = new Set<Element>();
  const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => schedule());

  const heightOf = (element: Element) => element.getBoundingClientRect().height / viewport.camera().zoom;
  const setVar = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  };

  function pad(element: HTMLElement): void {
    if (!grid) return;
    const height = heightOf(element);
    const extra = height === 0 ? 0 : wholeRules(height, grid) - height;
    setVar(element, '--rule-pad', `${Math.round(extra * 100) / 100}px`);
  }

  function align(): void {
    frame = 0;
    if (!grid) return;
    // The flow's first line goes to a rule: a lead below whatever sits above it, measured with no lead.
    if (grid.sheet === null) {
      setVar(flow, '--rule-lead', '0px');
      setVar(flow, '--rule-lead', `${Math.round(leadFor(flow.offsetTop, grid) * 100) / 100}px`);
    } else flow.style.removeProperty('--rule-lead');
    const found = new Set<Element>();
    for (const child of flow.children) {
      if (!(child instanceof HTMLElement) || child.dataset.ink !== undefined || child.style.left !== '') continue;
      found.add(child);
      pad(child);
    }
    for (const inner of flow.querySelectorAll<HTMLElement>(PADDED_INSIDE)) {
      found.add(inner);
      pad(inner);
    }
    for (const element of watched) if (!found.has(element)) resizes?.unobserve(element);
    for (const element of found) if (!watched.has(element)) resizes?.observe(element);
    watched.clear();
    found.forEach((element) => watched.add(element));
  }

  function schedule(): void {
    if (grid) frame ||= requestAnimationFrame(align);
  }

  function clear(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    delete world.dataset.ruled;
    for (const name of RULE_PROPERTIES) world.style.removeProperty(name);
    flow.style.removeProperty('--rule-lead');
    for (const element of watched) {
      resizes?.unobserve(element);
      (element as HTMLElement).style.removeProperty('--rule-pad');
    }
    watched.clear();
    resizes?.unobserve(flow);
    mutations?.disconnect();
  }

  return {
    current: () => grid,
    set(next: RuleGrid | null): void {
      const was = grid;
      grid = next;
      if (!next) return clear();
      const style = getComputedStyle(flow);
      const text = fontMetric(style.fontFamily);
      const mono = fontMetric(getComputedStyle(world).getPropertyValue('--font-mono') || 'monospace');
      world.dataset.ruled = '';
      for (const [name, value] of Object.entries(ruleProperties(next, { text, mono }))) setVar(world, name, value);
      if (!was) {
        resizes?.observe(flow);
        mutations?.observe(flow, { childList: true, subtree: true });
        // The fonts load after the page does, and the metric is measured from the loaded font.
        void document.fonts?.ready.then(() => {
          if (grid) setVar(world, '--rule-m', String(fontMetric(getComputedStyle(flow).fontFamily)));
        });
      }
      align();
    },
    stop: clear,
  };
}
