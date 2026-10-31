// The one error the signals engines throw: a message key under kitSignals.error and the values it names. The
// engines never write sentences, so a problem reads in the interface's language. A value that is itself a key
// under kitSignals (such as a field's label) is shown in words.
import type { en } from '../../../../strings/en';

export type ErrorKey = keyof (typeof en)['kitSignals']['error'];

export class SignalError extends Error {
  readonly key: ErrorKey;
  readonly vars: Readonly<Record<string, string | number>>;

  constructor(key: ErrorKey, vars: Record<string, string | number> = {}) {
    super(key);
    this.name = 'SignalError';
    this.key = key;
    this.vars = vars;
  }
}

export const isSignalError = (error: unknown): error is SignalError => error instanceof SignalError;
