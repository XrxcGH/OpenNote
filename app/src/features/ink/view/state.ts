// The Draw tab's state: the active tool and the pen slot it draws with. The pen slots themselves are settings
// (settings.ink.pens), so a color or width the person picks stays for the next session.
import type { PenSlot } from '../../../platform/bindings/PenSlot';
import { getSettings, updateSettings } from '../../../state/settings';
import { createStore } from '../../../state/store';
import type { InkTool } from '../geometry/types';
import { CUSTOM_SLOT, paletteByName, parseHex } from '../pens/palette';
import type { Rgba } from '../pens/palette';
import { DEFAULT_WIDTH_MM, mmToPage } from '../pens/tools';

/** What the pointer does on the page. 'select' is Phase 4's own tool: typing, and selecting blocks. */
export type DrawTool = 'select' | 'pen' | 'eraser' | 'partialEraser' | 'lasso';

export interface DrawState {
  readonly tool: DrawTool;
  /** The pen slot the pen tool draws with. */
  readonly slot: string;
}

export const drawState = createStore<DrawState>({ tool: 'select', slot: 'p1' }, 'ink draw state');

/** The router's tool ID for a draw tool: pens report their slot's tool, so other parts can tell ink from select. */
export function routerTool(state: DrawState): string {
  return state.tool === 'pen' ? (activeSlot(state)?.tool ?? 'pen') : state.tool;
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

export function chooseTool(tool: DrawTool, slot?: string): void {
  drawState.set((state) => ({ tool, slot: slot ?? state.slot }));
}
