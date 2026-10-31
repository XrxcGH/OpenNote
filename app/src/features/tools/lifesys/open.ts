// Opens the life-systems window, optionally at one tool. The request waits in a store, so a window that is already
// open switches tabs and one that opens later starts on the tool that was asked for.
import { createStore } from '../../../state/store';
import { takeKitInputs } from '../kits/registry';
import { openTool } from '../ui/host';
import { loadStored, saveStored } from '../ui/storage';
import { isLifeSysTool, type LifeSysToolId } from './meta';

export const lifeSysRequest = createStore<{ tool: LifeSysToolId | null; at: number }>(
  { tool: null, at: 0 },
  'life-systems tool request',
);

export function openLifeSys(tool?: LifeSysToolId): void {
  if (tool) lifeSysRequest.set({ tool, at: Date.now() });
  openTool('lifesys');
}

/** A live calculation block's inputs: the calculation within the tool and the typed values with their units. */
export interface LifeSysInputs {
  calc: string;
  values: { text: Record<string, string>; unit: Record<string, string> };
}

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

/** The block's inputs, or null when they are missing or not a life science calculation's. */
export function readLifeSysInputs(inputs: unknown): LifeSysInputs | null {
  if (!inputs || typeof inputs !== 'object') return null;
  const { calc, values } = inputs as { calc?: unknown; values?: { text?: unknown; unit?: unknown } };
  if (typeof calc !== 'string' || !calc || !values || typeof values !== 'object') return null;
  return { calc, values: { text: strings(values.text), unit: strings(values.unit) } };
}

/**
 * A live calculation block's Open in tool (through the kit registry): puts the block's calculation and values where
 * the window keeps them, then opens the window on that tool. A fresh request makes an open window read them again.
 */
export function reopenLifeSys(tool: string): void {
  if (!isLifeSysTool(tool)) {
    openLifeSys();
    return;
  }
  const inputs = readLifeSysInputs(takeKitInputs('lifesys', tool));
  if (inputs) {
    saveStored('lifesys.calc', { ...loadStored<Record<string, string>>('lifesys.calc', {}), [tool]: inputs.calc });
    saveStored(`lifesys.${tool}.${inputs.calc}`, inputs.values);
  }
  openLifeSys(tool);
}
