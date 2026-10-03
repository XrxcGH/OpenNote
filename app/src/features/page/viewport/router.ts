// The pointer router (ARCHITECTURE.md section 5.6; owner after WP0: WP3): it hands each pointer to the first tool,
// by priority, that claims it. Phase 4 registers gestures (50), objects (30), and select (10); Phase 5 adds palm
// rejection (100) and its ink tools (80). WP0's router keeps the tools and the active tool, and routes nothing yet,
// so the browser handles every pointer.
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
