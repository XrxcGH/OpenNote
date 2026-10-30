// Why a tool could not go on, by message key, so the window says it in words from kitMechDyn.errors.
import type { ErrorKey, Outcome } from '../types';

export class MechError extends Error {
  constructor(
    readonly key: ErrorKey,
    readonly vars: Readonly<Record<string, string>> = {},
  ) {
    super(key);
  }
}

export function fail(key: ErrorKey, vars?: Record<string, string>): never {
  throw new MechError(key, vars);
}

/** An engine's value, or its failure thrown as a MechError. */
export function unwrap<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome.value;
  throw new MechError(outcome.error, outcome.vars);
}
