// Every intel call rejects only with IntelClientError. The message is for logs. The interface picks its own words
// from the code, and offers to turn the feature on when the code is 'disabled'.

import { FEATURES } from './types';
import type { Feature, IntelErrorCode } from './types';

const CODES: readonly IntelErrorCode[] = [
  'unsupported',
  'languageUnavailable',
  'voiceUnavailable',
  'imageTooLarge',
  'invalidInput',
  'deviceUnavailable',
  'modelMissing',
  'canceled',
  'audio',
  'engine',
  'platform',
  'disabled',
];

export class IntelClientError extends Error {
  /** `unknown` covers a failure that did not come from the intel crate, such as a lost connection. */
  readonly code: IntelErrorCode | 'unknown';
  /** With 'disabled', the feature to offer to turn on. */
  readonly feature: Feature | null;

  constructor(code: IntelErrorCode | 'unknown', message: string, feature: Feature | null = null) {
    super(message);
    this.name = 'IntelClientError';
    this.code = code;
    this.feature = feature;
  }
}

export function isIntelError(error: unknown, code?: IntelErrorCode): error is IntelClientError {
  return error instanceof IntelClientError && (code === undefined || error.code === code);
}

function asFeature(value: unknown): Feature | null {
  return FEATURES.find((feature) => feature === value) ?? null;
}

/**
 * Any rejection as an IntelClientError. The Rust crate reports `{ code, message, feature }`, and the app's IPC layer
 * may carry the feature in `field` instead, so both are read.
 */
export function toIntelError(error: unknown): IntelClientError {
  if (error instanceof IntelClientError) return error;
  if (typeof error === 'object' && error !== null) {
    const { code, message, feature, field } = error as Record<string, unknown>;
    const known = CODES.find((c) => c === code);
    if (known) return new IntelClientError(known, String(message ?? ''), asFeature(feature ?? field));
  }
  const message = error instanceof Error ? error.message : String(error);
  return new IntelClientError('unknown', message);
}
