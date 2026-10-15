// The Draw tab's state: the active tool and the pen slot it draws with. The pen slots themselves are settings
// (settings.ink.pens), so a color or width the person picks stays for the next session.
import type { PenSet } from '../../../platform/bindings/PenSet';
import type { PenSlot } from '../../../platform/bindings/PenSlot';
import type { PenTool } from '../../../platform/bindings/PenTool';
import { getSettings, updateSettings } from '../../../state/settings';
import { createStore } from '../../../state/store';
import type { InkTool } from '../geometry/types';
import { CUSTOM_SLOT, paletteByName, parseHex } from '../pens/palette';
import type { Rgba } from '../pens/palette';
import { DEFAULT_WIDTH_MM, mmToPage, WIDTH_PRESETS_MM } from '../pens/tools';

/** What the pointer does on the page. 'select' is Phase 4's own tool: typing, and selecting blocks. */
export type DrawTool = 'select' | 'pen' | 'writing' | 'eraser' | 'partialEraser' | 'lasso' | 'insertSpace';

export interface DrawState {
  readonly tool: DrawTool;
  /** The tool chosen before this one, which the eraser can go back to when the pen lifts. */
  readonly previous: DrawTool;
  /** The pen slot the pen tool draws with. */
  readonly slot: string;
}

export const drawState = createStore<DrawState>({ tool: 'select', previous: 'select', slot: 'p1' }, 'ink draw state');

/** The router's tool ID for a draw tool: pens report their slot's tool, so other parts can tell ink from select. */
export function routerTool(state: DrawState): string {
  return state.tool === 'pen' || state.tool === 'writing' ? (activeSlot(state)?.tool ?? 'pen') : state.tool;
}

export function penSlots(): readonly PenSlot[] {
  return getSettings().ink.pens;
}

export function activeSlot(state: DrawState = drawState.get()): PenSlot | undefined {
  const slots = penSlots();
  return slots.find((slot) => slot.id === state.slot) ?? slots[0];
}

/** What a stroke stores for a pen slot: the tool, the palette slot, the light color, and the width in page units. */
export interface PenStyle {
  readonly tool: InkTool;
  readonly slot: number;
  readonly color: Rgba;
  readonly width: number;
  readonly name: string;
}

const FALLBACK: Rgba = [43, 37, 33, 255];

export function styleOf(slot: PenSlot | undefined): PenStyle {
  const tool: InkTool = slot?.tool ?? 'pen';
  const entry = slot ? paletteByName(slot.color) : undefined;
  const color = entry?.light ?? (slot ? parseHex(slot.color) : null) ?? FALLBACK;
  const width = mmToPage(slot?.width ?? DEFAULT_WIDTH_MM[tool]);
  return { tool, slot: entry?.slot ?? CUSTOM_SLOT, color, width, name: entry?.name ?? 'custom' };
}

/** Changes one pen slot in settings. */
export function updateSlot(id: string, change: Partial<Pick<PenSlot, 'color' | 'width'>>): Promise<void> {
  const pens = penSlots().map((slot) => (slot.id === id ? { ...slot, ...change } : slot));
  return updateSettings({ ink: { pens } });
}

/** The pens of the library (flag `ink.penLibrary`), in the order the Pen type menu lists them. */
export const LIBRARY_PENS: readonly PenTool[] = ['pen', 'fountain', 'brush', 'calligraphy', 'dashed', 'dotted'];

/** Changes a slot to another pen of the library. A width the new pen has no preset for becomes its default. */
export function setSlotTool(id: string, tool: PenTool): Promise<void> {
  const pens = penSlots().map((slot) => {
    if (slot.id !== id || slot.tool === 'highlighter') return slot;
    const width = WIDTH_PRESETS_MM[tool].includes(slot.width) ? slot.width : DEFAULT_WIDTH_MM[tool];
    return { ...slot, tool, width, pressure: true };
  });
  return updateSettings({ ink: { pens } });
}

export const MAX_PEN_SETS = 12;

export function penSets(): readonly PenSet[] {
  return getSettings().ink.penSets ?? [];
}

/** Saves the pens now on the palette as a named set. A name already used replaces that set. */
export function savePenSet(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 40);
  const kept = penSets().filter((set) => set.name !== trimmed);
  const existing = penSets().find((set) => set.name === trimmed);
  const id = existing?.id ?? `set-${Date.now().toString(36)}`;
  const next = [...kept, { id, name: trimmed, pens: penSlots().map((slot) => ({ ...slot })) }].slice(-MAX_PEN_SETS);
  return updateSettings({ ink: { penSets: next } });
}

/** Puts a saved set's pens on the palette. */
export function applyPenSet(id: string): Promise<void> {
  const set = penSets().find((s) => s.id === id);
  if (!set || set.pens.length === 0) return Promise.resolve();
  return updateSettings({ ink: { pens: set.pens.map((slot) => ({ ...slot })) } });
}

export function deletePenSet(id: string): Promise<void> {
  return updateSettings({ ink: { penSets: penSets().filter((set) => set.id !== id) } });
}

export function chooseTool(tool: DrawTool, slot?: string): void {
  drawState.set((state) => ({
    tool,
    previous: state.tool === tool ? state.previous : state.tool,
    slot: slot ?? state.slot,
  }));
}

/** True for the tools that write ink with the pen's slot. */
export const writesInk = (tool: DrawTool): boolean => tool === 'pen' || tool === 'writing';
