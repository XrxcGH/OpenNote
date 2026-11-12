// The spreadsheet table that keys and the palette act on: the one that had focus last. A light module, so the
// commands can ask it at start-up without loading the editor code.
import type { CommandId } from '../../../commands/types';

export interface SheetRunner {
  /** Runs a sheet command on this table. False when it does nothing here. */
  run(id: CommandId): boolean;
  /** Whether this table uses document keys. */
  documentKeys(): boolean;
}

let current: SheetRunner | null = null;

export function activeSheet(): SheetRunner | null {
  return current;
}

export function setActiveSheet(runner: SheetRunner): void {
  current = runner;
}

/** Forgets the runner when it is the active one, such as when its table goes. */
export function clearActiveSheet(runner: SheetRunner): void {
  if (current === runner) current = null;
}
