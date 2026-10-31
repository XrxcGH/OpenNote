// Opens the kit window on one tool. The palette commands load this module when they run, and a live calculation
// block's Open in tool comes back here through the kit registry with the inputs it saved.
import { takeKitInputs } from '../kits/registry';
import { saveStored } from '../ui/storage';
import { isCivilToolId } from './meta';
import type { CivilToolId } from './meta';
import { choose } from './selection';

/** The kit's id in the kit registry and in its live calculation blocks. */
export const CIVIL_KIT_ID = 'civil';

/** Tells an open calculation form to read its saved inputs again; detail is the form's storage name. */
export const CIVIL_RESTORE_EVENT = 'opennote:kit-civil-restore';

export const civilValuesStore = (tool: string, calc: string): string => `kit-civil.values.${tool}.${calc}`;

export async function openCivilTool(tool: CivilToolId, calc?: string): Promise<void> {
  choose(tool, calc);
  (await import('../ui/host')).openTool('kit-civil');
}

/** A live block's inputs: the form's typed texts and units. */
function readState(inputs: unknown): { text: Record<string, string>; unit: Record<string, string> } | null {
  if (!inputs || typeof inputs !== 'object') return null;
  const { text, unit } = inputs as { text?: unknown; unit?: unknown };
  const strings = (value: unknown) =>
    value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : null;
  const t = strings(text);
  return t ? { text: t, unit: strings(unit) ?? {} } : null;
}

/** Open in tool on a live block: `key` is "tool.calc"; the saved inputs go back into that form before it opens. */
export async function reopenCivilCalc(key: string): Promise<void> {
  const [tool, calc] = key.split('.');
  if (!isCivilToolId(tool) || !calc) return;
  const state = readState(takeKitInputs(CIVIL_KIT_ID, key));
  if (state) {
    const store = civilValuesStore(tool, calc);
    saveStored(store, state);
    window.dispatchEvent(new CustomEvent<string>(CIVIL_RESTORE_EVENT, { detail: store }));
  }
  await openCivilTool(tool, calc);
}
