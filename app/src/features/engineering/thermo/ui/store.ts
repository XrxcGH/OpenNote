// What the thermodynamics kit remembers on this device: the open tool, the unit system, and each tool's typed
// inputs. It shares the tool windows' storage prefix, so a kit in a window of its own reads what the docked one
// saved. Reading and writing never throw: blocked storage only means the kit starts fresh.
import { THERMO_TOOL_IDS, type ThermoToolId } from '../meta';
import type { System } from '../common/units';

const PREFIX = 'opennote.tools.thermo.';

export function loadSaved<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function saveSaved(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The kit keeps working; it just will not remember.
  }
}

const listeners = new Set<(tool: ThermoToolId) => void>();

export function storedTool(): ThermoToolId {
  const saved = loadSaved<string>('tab', THERMO_TOOL_IDS[0]);
  return (THERMO_TOOL_IDS as readonly string[]).includes(saved) ? (saved as ThermoToolId) : THERMO_TOOL_IDS[0];
}

/** Picks the tool the kit shows now and the next time it opens. */
export function chooseTool(tool: ThermoToolId): void {
  saveSaved('tab', tool);
  for (const listener of listeners) listener(tool);
}

export function onTool(listener: (tool: ThermoToolId) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const storedSystem = (): System => (loadSaved<string>('system', 'SI') === 'US' ? 'US' : 'SI');
export const saveSystem = (system: System): void => saveSaved('system', system);

/** A tool's saved form: the mode, and the typed text and unit of each field. */
export interface SavedForm {
  mode: string;
  text: Record<string, string>;
  unit: Record<string, string>;
}

export const loadForm = (tool: ThermoToolId): SavedForm | null => loadSaved<SavedForm | null>(`form.${tool}`, null);
export const saveForm = (tool: ThermoToolId, form: SavedForm): void => saveSaved(`form.${tool}`, form);
