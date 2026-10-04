// The page's layout actions (ARCHITECTURE.md sections 6 and 11.1; owner WP3): new text boxes, the page layout, and
// the compact Reading view. A new text box is a caret first: a draft block that joins page.json with its first
// change, and disappears unsaved if it loses focus while empty, so a tap never creates anything hidden.
import { newId } from '../../../editor/ids';
import type { BlockId, BlockJson, OpenPage, PageViewJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, buttonClass } from '../../../ui';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { DISCARD_DRAFT, markDraft, markEphemeral } from '../blocks/textBlock';
import type { PagePool } from '../pool/pool';
import { byOrder } from '../readingOrder/order';
import { savePageView } from '../runtime';
import type { SyncQueue } from '../sync';
import type { Point } from '../viewport/camera';
import type { PageActions } from '../viewport/shown';
import { isFloating } from '../blocks/textBlock';
import styles from './layout.module.css';
import type { PageViewport } from '../viewport/viewport';
import type { Flow } from './flow';
import { snapY } from './rules';

/** An RFC 7396 merge patch over a view: null removes a key, an object merges, anything else replaces. */
function mergePatch(view: PageViewJson, patch: Record<string, unknown>): PageViewJson {
  const out: Record<string, unknown> = { ...view };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key] !== null) {
      out[key] = mergePatch(out[key] as PageViewJson, value as Record<string, unknown>);
    } else out[key] = value;
  }
  return out as PageViewJson;
}

/** The page's view in this window, the flow that follows it, and the listeners that hear each change. */
function viewChannel(initial: PageViewJson, flow: Flow) {
  let view: PageViewJson = initial;
  const listeners = new Set<(view: PageViewJson) => void>();
  return {
    get: () => view,
    /** Replaces the view, moves the flow to it, and tells the listeners. */
    set(next: PageViewJson) {
      view = next;
      flow.setView(view);
      listeners.forEach((listener) => listener(view));
    },
    listen(listener: (view: PageViewJson) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** A new text box goes this far below the block it follows. */
export const BELOW_GAP = 16;
/** Half a Normal line: a tapped caret's first line is centered on the tap. */
const HALF_LINE = 12;

export interface LayoutParts {
  readonly page: OpenPage;
  readonly sync: SyncQueue;
  readonly layer: PageBlockLayer;
  readonly pool: PagePool;
  readonly flow: Flow;
  readonly viewport: PageViewport;
  readonly compact: boolean;
  readonly reading: boolean;
}

export interface PageLayout extends Omit<PageActions, 'objectCommand' | 'objectEnabled'> {
  /** A press on empty page that didn't move: a caret on a freeform page, the flow's end on a flow page. */
  pressEmpty(point: Point): void;
  /** Undo or another window changed the view. */
  setView(view: PageViewJson): void;
  /** The page's view as this window knows it now, with Phase 6's fields (mode, paper, background). */
  view(): PageViewJson;
  /** Calls `listener` after any change to the view, from this window, undo, or another window. */
  onView(listener: (view: PageViewJson) => void): () => void;
  /** Records a view change made by Phase 6's page setup: the page sends the patch, and the flow follows. */
  patchView(patch: Record<string, unknown>): void;
  stop(): void;
}

export function createPageLayout(parts: LayoutParts): PageLayout {
  const { page, sync, layer, pool, flow, viewport } = parts;
  const channel = viewChannel({ ...page.initial.view }, flow);
  let reading = parts.reading;
  let lastFocused: BlockId | null = null;
  const stopActive = pool.onActiveChange((block) => {
    if (block) lastFocused = block;
  });
  const onDiscard = (event: Event) => layer.remove((event as CustomEvent<BlockId>).detail);
  flow.element.addEventListener(DISCARD_DRAFT, onDiscard);
  const switcher =
    parts.compact && layer.blocks().some(isFloating)
      ? viewSwitch(
          flow,
          () => reading,
          () => self,
        )
      : null;

  /** The block a new floating block goes after: before the ink layer, else after the last floating block. */
  const insertAfter = (): BlockId | undefined => {
    const point = layer.insertionPoint('floating');
    if (point.after) return point.after;
    if (!point.before) return undefined;
    const sorted = [...layer.blocks()].sort(byOrder);
    return sorted[sorted.findIndex((block) => block.id === point.before) - 1]?.id;
  };

  const caretAt = (at: Point, floating: boolean) => {
    const now = new Date().toISOString();
    const id = newId();
    // On ruled paper a new text box starts on a rule, so its first line is on the rules.
    const top = Math.max(0, Math.round(at.y));
    const frame = floating ? { x: Math.max(0, Math.round(at.x)), y: Math.round(snapY(top, flow.rules())) } : undefined;
    const block: BlockJson = { id, type: 'text', order: '~', created: now, modified: now, data: { markdown: '' } };
    if (frame) block.frame = frame;
    const after = floating ? insertAfter() : layer.blocks().at(-1)?.id;
    markEphemeral(markDraft(block, { block: { id, type: 'text', ...(frame ? { frame } : {}) }, after }));
    layer.upsert(block);
    pool.mount(id, { kind: 'start' }, 'target');
  };

  /** 16 units below the last focused block, or the view's top left. */
  const newTextBoxPoint = (): Point => {
    const last = lastFocused ? layer.block(lastFocused) : null;
    const element = lastFocused ? layer.view(lastFocused)?.element : null;
    if (last?.frame?.x !== undefined && last.frame.y !== undefined && element) {
      return { x: last.frame.x, y: last.frame.y + element.offsetHeight + BELOW_GAP };
    }
    const camera = viewport.camera();
    return { x: camera.scrollX / camera.zoom + 48, y: camera.scrollY / camera.zoom + 24 };
  };

  const self: PageLayout = {
    newTextBox: () => caretAt(newTextBoxPoint(), true),
    pressEmpty(point) {
      if (page.readOnly) return;
      if (reading || channel.get().layout === 'flow') {
        const last = [...layer.blocks()].reverse().find((block) => block.type === 'text' && !block.frame?.y);
        if (last) return void pool.mount(last.id, { kind: 'end' }, 'target');
        return caretAt(point, false);
      }
      caretAt({ x: point.x, y: point.y - HALF_LINE }, true);
    },
    layout: () => (channel.get().layout === 'flow' ? 'flow' : 'freeform'),
    setLayout(layout) {
      if ((channel.get().layout ?? 'freeform') === layout) return;
      channel.set({ ...channel.get(), layout });
      void sync.send({ edits: [{ edit: 'setPage', view: { layout } }] });
      announce(t(layout === 'flow' ? 'page.layout.nowFlow' : 'page.layout.nowFreeform'));
    },
    readingAvailable: () => parts.compact,
    reading: () => reading,
    setReading(on) {
      if (reading === on) return;
      reading = on;
      flow.setReading(on);
      switcher?.update();
      savePageView(page.id, { view: on ? 'reading' : 'canvas' });
      announce(t(on ? 'page.reading.nowReading' : 'page.reading.nowCanvas'));
    },
    setView: (next) => channel.set({ ...channel.get(), ...next }),
    view: channel.get,
    onView: channel.listen,
    patchView(patch) {
      channel.set(mergePatch(channel.get(), patch));
      void sync.send({ edits: [{ edit: 'setPage', view: patch }] });
    },
    stop() {
      stopActive();
      switcher?.element.remove();
      flow.element.removeEventListener(DISCARD_DRAFT, onDiscard);
    },
  };
  return self;
}

/** The compact size class's "Canvas" button, which switches a page with floating blocks out of the Reading view. */
function viewSwitch(
  flow: Flow,
  reading: () => boolean,
  layout: () => PageLayout,
): { element: HTMLButtonElement; update(): void } {
  const element = flow.element.ownerDocument.createElement('button');
  element.type = 'button';
  element.className = buttonClass('secondary', styles.viewSwitch);
  const update = () => {
    element.textContent = t(reading() ? 'page.reading.toCanvas' : 'page.reading.toReading');
    element.setAttribute('aria-pressed', String(!reading()));
  };
  element.addEventListener('click', () => layout().setReading(!reading()));
  update();
  flow.element.before(element);
  return { element, update };
}
