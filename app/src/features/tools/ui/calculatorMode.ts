// Which mode the calculator shows, kept with the tools' other choices so a popped-out window opens on the same one.
// A command can pick the mode before it opens the calculator; a calculator already open follows the choice.
import { openTool } from './host';
import { loadStored, saveStored, watchStored } from './storage';

export const CALCULATOR_MODES = [
  'basic',
  'scientific',
  'graphing',
  'graphing3d',
  'programmer',
  'statistics',
  'matrix',
] as const;
export type CalculatorMode = (typeof CALCULATOR_MODES)[number];

const STORE = 'calculator.tab';
const EVENT = 'opennote:calculator-mode';

export const isCalculatorMode = (value: unknown): value is CalculatorMode =>
  CALCULATOR_MODES.some((mode) => mode === value);

export function savedCalculatorMode(): CalculatorMode | null {
  const saved = loadStored<unknown>(STORE, null);
  return isCalculatorMode(saved) ? saved : null;
}

export function saveCalculatorMode(mode: CalculatorMode): void {
  saveStored(STORE, mode);
}

/** Calls `changed` when a command in this window, or another window, picks a mode. */
export function followCalculatorMode(changed: () => void): () => void {
  const stop = watchStored(STORE, changed);
  window.addEventListener(EVENT, changed);
  return () => {
    stop();
    window.removeEventListener(EVENT, changed);
  };
}

/** Opens the calculator on a mode. */
export function openCalculator(mode: CalculatorMode): void {
  saveCalculatorMode(mode);
  window.dispatchEvent(new CustomEvent(EVENT));
  openTool('calculator');
}
