// Ink layers (ADR 0037, flag ink.layers): named layers of ink that can be hidden, locked, renamed and reordered. New ink
// goes to the active layer, and the lasso can move writing to another. The layers live in the page's view under
// `inkLayers`, like object groups (ADR 0036): the layers and their order, and `assign`, a map from a stroke to its layer
// for the strokes that are not on the first layer. Every change is a `setPage` patch in the batch with the strokes it
// concerns, so each is one undo step. Hidden layers are not drawn, printed or exported; locked layers are drawn but the
// pen, the erasers and the lasso pass over them.
import { isEnabled } from '../../../app/flags';
import { newId } from '../../../editor/ids';
import type { Edit, OpenPage } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { InkHost } from './host';
import type { InkStroke } from '../model/types';
import type { InkSurface } from './surface';

/** The layer every page has and every stroke is on until it is moved. It cannot be deleted. */
export const BASE_LAYER = 'base';

export interface LayerDef {
  readonly name: string;
  readonly hidden: boolean;
  readonly locked: boolean;
  /** Made for imported PDF pages and slides: locked, at the bottom. */
  readonly imported: boolean;
}

export interface InkLayers {
  /** Bottom first. */
  readonly order: readonly string[];
  readonly defs: ReadonlyMap<string, LayerDef>;
  readonly assign: ReadonlyMap<string, string>;
}

export const MAX_LAYERS = 24;

const BASE_DEF: LayerDef = { name: '', hidden: false, locked: false, imported: false };

export const noLayers = (): InkLayers => ({
  order: [BASE_LAYER],
  defs: new Map([[BASE_LAYER, BASE_DEF]]),
  assign: new Map(),
});

/** The layers a page view holds. Anything damaged is skipped, and the base layer is always there. */
export function layersOf(view: unknown): InkLayers {
  const held = (view as { inkLayers?: unknown } | null | undefined)?.inkLayers;
  const base = noLayers();
  if (!held || typeof held !== 'object') return base;
  const record = held as { order?: unknown; layers?: unknown; assign?: unknown };
  const defs = new Map(base.defs);
  if (record.layers && typeof record.layers === 'object' && !Array.isArray(record.layers)) {
    for (const [id, value] of Object.entries(record.layers as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const def = value as Partial<Record<keyof LayerDef, unknown>>;
      defs.set(id, {
        name: typeof def.name === 'string' ? def.name : '',
        hidden: def.hidden === true,
        locked: def.locked === true,
        imported: def.imported === true,
      });
    }
  }
  const stored = Array.isArray(record.order) ? record.order.filter((id): id is string => typeof id === 'string') : [];
  const order = stored.filter((id, i) => defs.has(id) && stored.indexOf(id) === i);
  if (!order.includes(BASE_LAYER)) order.unshift(BASE_LAYER);
  for (const id of defs.keys()) if (!order.includes(id)) order.push(id);
  const assign = new Map<string, string>();
  if (record.assign && typeof record.assign === 'object' && !Array.isArray(record.assign)) {
    for (const [stroke, layer] of Object.entries(record.assign as Record<string, unknown>)) {
      if (typeof layer === 'string' && defs.has(layer) && layer !== BASE_LAYER) assign.set(stroke, layer);
    }
  }
  return { order, defs, assign };
}

/** The layer a stroke is on. A piece cut by the partial eraser stays on the layer of the stroke it came from. */
export function layerOfStroke(layers: InkLayers, stroke: { id: string; origin?: string }): string {
  return layers.assign.get(stroke.id) ?? (stroke.origin ? layers.assign.get(stroke.origin) : undefined) ?? BASE_LAYER;
}

export const isHiddenStroke = (layers: InkLayers, stroke: { id: string; origin?: string }): boolean =>
  layers.defs.get(layerOfStroke(layers, stroke))?.hidden === true;

export const isLockedStroke = (layers: InkLayers, stroke: { id: string; origin?: string }): boolean =>
  layers.defs.get(layerOfStroke(layers, stroke))?.locked === true;

/** The name shown for a layer: the base layer is "Layer 1" until it is renamed. */
export function layerName(layers: InkLayers, id: string): string {
  const name = layers.defs.get(id)?.name ?? '';
  if (name) return name;
  return id === BASE_LAYER ? t('ink.layers.baseName') : t('ink.layers.unnamed');
}

/** The layer new ink goes to: the active one when it can be drawn on, else the highest layer that can. */
export function drawableLayer(layers: InkLayers, active: string): string {
  const usable = (id: string) => {
    const def = layers.defs.get(id);
    return !!def && !def.hidden && !def.locked;
  };
  if (usable(active)) return active;
  return [...layers.order].reverse().find(usable) ?? BASE_LAYER;
}

// ---- patches ----

export interface LayersPatch {
  readonly order?: readonly string[];
  /** A definition sets or renames a layer; null deletes it. */
  readonly layers?: Readonly<Record<string, LayerDef | null>>;
  /** A layer places a stroke; null puts it back on the base layer. */
  readonly assign?: Readonly<Record<string, string | null>>;
}

/** The view patch for a change to the layers. */
export function layersEdit(patch: LayersPatch): Edit {
  const inkLayers: Record<string, unknown> = {};
  if (patch.order) inkLayers.order = [...patch.order];
  if (patch.layers) inkLayers.layers = { ...patch.layers };
  if (patch.assign) inkLayers.assign = { ...patch.assign };
  return { edit: 'setPage', view: { inkLayers } };
}

/** The layers after a change made with `layersEdit`. */
export function applyLayersPatch(layers: InkLayers, patch: LayersPatch): InkLayers {
  const defs = new Map(layers.defs);
  for (const [id, def] of Object.entries(patch.layers ?? {})) {
    if (def) defs.set(id, def);
    else defs.delete(id);
  }
  const assign = new Map(layers.assign);
  for (const [stroke, layer] of Object.entries(patch.assign ?? {})) {
    if (layer && layer !== BASE_LAYER && defs.has(layer)) assign.set(stroke, layer);
    else assign.delete(stroke);
  }
  const order = (patch.order ?? layers.order).filter((id) => defs.has(id));
  if (!order.includes(BASE_LAYER)) order.unshift(BASE_LAYER);
  for (const id of defs.keys()) if (!order.includes(id)) order.push(id);
  return { order, defs, assign };
}

/** A new layer, above the others. Null when the page has the most layers it may. */
export function addLayerPatch(layers: InkLayers, name: string, id: string = newId()): LayersPatch | null {
  if (layers.order.length >= MAX_LAYERS) return null;
  return {
    layers: { [id]: { name: name.trim().slice(0, 40), hidden: false, locked: false, imported: false } },
    order: [...layers.order, id],
  };
}

export function setLayerPatch(layers: InkLayers, id: string, change: Partial<LayerDef>): LayersPatch | null {
  const def = layers.defs.get(id);
  if (!def) return null;
  const next = { ...def, ...change, name: (change.name ?? def.name).trim().slice(0, 40) };
  return { layers: { [id]: next } };
}

/** One step up or down in the stack. Null at the end of the stack, or when the layer is the locked imported one. */
export function movePatch(layers: InkLayers, id: string, direction: 'up' | 'down'): LayersPatch | null {
  const i = layers.order.indexOf(id);
  const j = direction === 'up' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= layers.order.length) return null;
  if (layers.defs.get(layers.order[j])?.imported || layers.defs.get(id)?.imported) return null;
  const order = [...layers.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { order };
}

/** Deleting a layer puts its strokes on the base layer. The base layer cannot be deleted. */
export function deletePatch(layers: InkLayers, id: string): LayersPatch | null {
  if (id === BASE_LAYER || !layers.defs.has(id)) return null;
  const assign: Record<string, string | null> = {};
  for (const [stroke, layer] of layers.assign) if (layer === id) assign[stroke] = null;
  return { layers: { [id]: null }, order: layers.order.filter((x) => x !== id), assign };
}

/** Moves strokes to a layer. */
export function moveStrokesPatch(strokes: readonly string[], layer: string): LayersPatch {
  return { assign: Object.fromEntries(strokes.map((id) => [id, layer === BASE_LAYER ? null : layer])) };
}

/**
 * The layer for imported PDF pages and slides: locked, at the bottom, under the base layer. Null when the page has one.
 */
export function importedLayerPatch(layers: InkLayers, id: string = newId()): LayersPatch | null {
  if ([...layers.defs.values()].some((def) => def.imported)) return null;
  return {
    layers: { [id]: { name: '', hidden: false, locked: true, imported: true } },
    order: [id, ...layers.order],
  };
}

/**
 * The edit that gives a page with imported PDF pages or slides its locked bottom layer, or null when the page has one
 * or layers are off. The shown page is read from the live layers, any other page from `view`, its view as opened.
 */
export function importedLayerEdit(pageId: string, view: unknown): Edit | null {
  if (!isEnabled('ink.layers')) return null;
  const layers = adopted?.page === pageId ? inkLayers.get() : layersOf(view);
  const patch = importedLayerPatch(layers);
  return patch ? layersEdit(patch) : null;
}

// ---- the shown page's layers ----

export const inkLayers = createStore<InkLayers>(noLayers(), 'ink layers');
/** The layer new ink goes to. It is not saved: each time a page opens, ink goes to the base layer. */
export const activeLayer = createStore<string>(BASE_LAYER, 'ink active layer');

let adopted: { page: string; stop: () => void } | null = null;

function adopt(page: OpenPage | null): void {
  if (adopted && adopted.page === page?.id) return;
  adopted?.stop();
  adopted = null;
  inkLayers.set(noLayers());
  activeLayer.set(BASE_LAYER);
  if (!page) return;
  inkLayers.set(layersOf(page.initial.view));
  const stop = page.onFrame((frame) => {
    if (frame.page?.view) inkLayers.set(layersOf(frame.page.view));
  });
  adopted = { page: page.id, stop };
}

/** The edits that put new strokes on the layer ink is going to, in the same batch as the strokes. */
function placementFor(strokes: readonly InkStroke[]): Edit[] {
  const layers = inkLayers.get();
  const target = drawableLayer(layers, activeLayer.get());
  const assign: Record<string, string | null> = {};
  for (const stroke of strokes) {
    const own = stroke.origin ? layerOfStroke(layers, stroke) : target;
    if (own !== BASE_LAYER) assign[stroke.id] = own;
  }
  if (Object.keys(assign).length === 0) return [];
  // The store takes the placement now, so the strokes are on their layer as soon as they are drawn.
  inkLayers.set((current) => applyLayersPatch(current, { assign }));
  return [layersEdit({ assign })];
}

/** Applies the layers to the shown surface: what is hidden, what is locked, and where new ink goes. */
function apply(surface: InkSurface | null): void {
  if (!surface) return;
  const layers = inkLayers.get();
  const several = layers.order.length > 1;
  surface.setLayerRules(
    several
      ? {
          hides: (stroke) => isHiddenStroke(inkLayers.get(), stroke),
          blocks: (stroke) => isLockedStroke(inkLayers.get(), stroke),
        }
      : null,
    several ? placementFor : null,
  );
}

/** Follows the shown page's layers, and keeps the surface's rules in step with them. */
export function installLayers(
  host: InkHost,
  surfaces: { get(): InkSurface | null; subscribe(l: () => void): () => void },
): () => void {
  adopt(host.page.get());
  const reapply = () => apply(surfaces.get());
  reapply();
  const stops = [
    host.page.subscribe(() => {
      adopt(host.page.get());
      reapply();
    }),
    surfaces.subscribe(reapply),
    inkLayers.subscribe(reapply),
  ];
  return () => {
    stops.forEach((stop) => stop());
    surfaces.get()?.setLayerRules(null);
    adopted?.stop();
    adopted = null;
  };
}

/** Sends a change to the layers, and takes it into the store once the page has it. */
export async function sendLayers(surface: InkSurface, patch: LayersPatch): Promise<boolean> {
  const before = inkLayers.get();
  inkLayers.set(applyLayersPatch(before, patch));
  const ok = await surface.send({ edits: [layersEdit(patch)] }, () => inkLayers.set(before));
  return ok;
}

/** Moves the selected writing to a layer. */
export async function moveSelectionToLayer(host: InkHost, surface: InkSurface, layer: string): Promise<void> {
  const ids = host.selection.get().strokes;
  if (ids.length === 0) return announce(t('ink.layers.selectFirst'));
  if (!inkLayers.get().defs.has(layer)) return;
  if (await sendLayers(surface, moveStrokesPatch(ids, layer))) {
    announce(t('ink.layers.moved', { count: ids.length, layer: layerName(inkLayers.get(), layer) }));
  }
}

/** The ids of the strokes on hidden layers (or, with `only`, off that layer) among these, for export and print. */
export function excludedFromExport(
  layers: InkLayers,
  ids: Iterable<{ id: string; origin?: string }>,
  only?: string,
): Set<string> {
  const out = new Set<string>();
  for (const stroke of ids) {
    const layer = layerOfStroke(layers, stroke);
    if (layers.defs.get(layer)?.hidden || (only !== undefined && layer !== only)) out.add(stroke.id);
  }
  return out;
}
