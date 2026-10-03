// The pointer router (ARCHITECTURE.md section 5.6; owner after WP0: WP3): it hands each pointer to the first tool,
// by priority, that claims it. Phase 4 registers gestures (50), objects (30), and select (10); Phase 5 adds palm
// rejection (100) and its ink tools (80). It listens on the viewport in the capture phase. A claimed pointer's
// events are canceled and stopped there, which also stops the compatibility mouse events. So a claimed pen
// contact never reaches the blocks: it never moves a caret, focuses, or blurs an editor.
import type { BlockId } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import type { Camera, Point } from './camera';

export interface RouterContext {
  readonly camera: Camera;
  /** 'select' in Phase 4; Phase 5 adds pen, highlighter, eraser, and lasso. */
  readonly activeTool: string;
  toWorld(clientX: number, clientY: number): Point;
  blockAt(point: Point): BlockId | null;
  /** setPointerCapture on the viewport. */
  capture(pointerId: number): void;
}

export interface PointerToolDef {
  readonly id: string;
  /** Higher runs first. */
  readonly priority: number;
  accepts(event: PointerEvent, ctx: RouterContext): boolean;
  /** 'watch' observes until a slop decides. */
  down(event: PointerEvent, ctx: RouterContext): 'claim' | 'watch';
  move?(events: readonly PointerEvent[], ctx: RouterContext): 'claim' | 'watch' | 'release';
  up?(event: PointerEvent, ctx: RouterContext): void;
  cancel?(ctx: RouterContext): void;
}

const tools = new Map<string, PointerToolDef>();

export const activeTool = createStore<string>('select', 'page active tool');

/** The registered tools, highest priority first. */
export function pointerTools(): PointerToolDef[] {
  return [...tools.values()].sort((a, b) => b.priority - a.priority);
}

export function registerPointerTool(def: PointerToolDef): () => void {
  if (tools.has(def.id)) throw new Error(`A pointer tool with the id "${def.id}" is already registered.`);
  tools.set(def.id, def);
  return () => void (tools.get(def.id) === def && tools.delete(def.id));
}

export function setActiveTool(id: string): void {
  activeTool.set(id);
}

/** What the router needs from the page it routes for. */
export interface RouterHost {
  /** Where pointers press: the viewport and the chrome layer beside it. */
  readonly element: HTMLElement;
  /** What captures a claimed pointer: the viewport. Defaults to `element`. */
  readonly captureElement?: HTMLElement;
  camera(): Camera;
  toWorld(clientX: number, clientY: number): Point;
  blockAt(point: Point): BlockId | null;
  /** The page's own tools, which join the registered ones. */
  readonly tools: readonly PointerToolDef[];
}

interface Routed {
  owner: PointerToolDef | null;
  watchers: PointerToolDef[];
}

const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const;

function claimEvent(event: PointerEvent): void {
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

/** Starts routing the pointers that press inside `host.element`. Returns a function that stops. */
export function createRouter(host: RouterHost): () => void {
  const routed = new Map<number, Routed>();
  const context = (): RouterContext => ({
    camera: host.camera(),
    activeTool: activeTool.get(),
    toWorld: (x, y) => host.toWorld(x, y),
    blockAt: (point) => host.blockAt(point),
    capture(pointerId) {
      try {
        (host.captureElement ?? host.element).setPointerCapture(pointerId);
      } catch {
        // A pointer that already ended can't be captured; its up event follows.
      }
    },
  });
  const all = () => [...pointerTools(), ...host.tools].sort((a, b) => b.priority - a.priority);

  const down = (event: PointerEvent) => {
    const ctx = context();
    const entry: Routed = { owner: null, watchers: [] };
    for (const tool of all()) {
      if (!tool.accepts(event, ctx)) continue;
      if (tool.down(event, ctx) === 'claim') {
        entry.watchers.forEach((watcher) => watcher.cancel?.(ctx));
        entry.watchers = [];
        entry.owner = tool;
        break;
      }
      entry.watchers.push(tool);
    }
    if (!entry.owner && entry.watchers.length === 0) return;
    routed.set(event.pointerId, entry);
    if (entry.owner) claimEvent(event);
  };

  const move = (event: PointerEvent) => {
    const entry = routed.get(event.pointerId);
    if (!entry) return;
    const coalesced = event.getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [event];
    const ctx = context();
    if (entry.owner) {
      entry.owner.move?.(events, ctx);
      return claimEvent(event);
    }
    for (const watcher of [...entry.watchers]) {
      const verdict = watcher.move?.(events, ctx) ?? 'watch';
      if (verdict === 'release') entry.watchers.splice(entry.watchers.indexOf(watcher), 1);
      if (verdict !== 'claim') continue;
      entry.watchers.filter((other) => other !== watcher).forEach((other) => other.cancel?.(ctx));
      entry.watchers = [];
      entry.owner = watcher;
      return claimEvent(event);
    }
  };

  const up = (event: PointerEvent) => {
    const entry = routed.get(event.pointerId);
    if (!entry) return;
    routed.delete(event.pointerId);
    const ctx = context();
    if (entry.owner) {
      entry.owner.up?.(event, ctx);
      return claimEvent(event);
    }
    entry.watchers.forEach((watcher) => watcher.up?.(event, ctx));
  };

  const cancel = (event: PointerEvent) => {
    const entry = routed.get(event.pointerId);
    if (!entry) return;
    routed.delete(event.pointerId);
    const ctx = context();
    (entry.owner ? [entry.owner] : entry.watchers).forEach((tool) => tool.cancel?.(ctx));
  };

  const lost = (event: PointerEvent) => {
    // Touch and pen pointers start captured by what they pressed. Moving the capture to the viewport takes it from
    // that element, which fires lostpointercapture there: no reason to stop, or a touch pan would end at once.
    if (event.target !== (host.captureElement ?? host.element)) return;
    cancel(event);
  };

  const handlers: Record<(typeof EVENTS)[number], (event: PointerEvent) => void> = {
    pointerdown: down,
    pointermove: move,
    pointerup: up,
    pointercancel: cancel,
    lostpointercapture: lost,
  };
  for (const type of EVENTS) host.element.addEventListener(type, handlers[type], { capture: true });
  return () => {
    for (const type of EVENTS) host.element.removeEventListener(type, handlers[type], { capture: true });
    const ctx = context();
    for (const entry of routed.values()) (entry.owner ? [entry.owner] : entry.watchers).forEach((t) => t.cancel?.(ctx));
    routed.clear();
  };
}
