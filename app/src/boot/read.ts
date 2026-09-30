// Reads the boot payload Rust injects before any page script runs (ARCHITECTURE.md section 6.3). A plain browser
// has none, so it falls back to web defaults with the browser's appearance. Web builds also take development
// options from the address, such as ?fixture=large.

import { isFixtureName } from '../services/notes/fixtures';
import type { FixtureName } from '../services/notes/fixtures';
import type { BootData } from '../platform/types';
import { browserAppearance, defaultBootData, mergeBoot } from './defaults';

export interface DevOptions {
  /** The seed library for the web platform. */
  fixture?: FixtureName;
  /** Every string in the pseudo-locale. */
  pseudo: boolean;
}

function injected(): unknown {
  return typeof window === 'undefined' ? undefined : window.__OPENNOTE_BOOT__;
}

/** True when the host injected a boot payload of a version this build reads. */
export function hasInjectedBoot(): boolean {
  const boot = injected() as { bootVersion?: unknown } | undefined;
  return typeof boot === 'object' && boot !== null && boot.bootVersion === 1;
}

/**
 * The boot payload, or web defaults when there is none. A partial payload, such as one a Playwright test sets,
 * fills in from the defaults.
 */
export function readBoot(): BootData {
  const fallback = defaultBootData(browserAppearance());
  return hasInjectedBoot() ? mergeBoot(fallback, injected() as Partial<BootData>) : fallback;
}

/** Development options from the address (?fixture=large&pseudo) or from window.__OPENNOTE_DEV__. */
export function readDevOptions(search = typeof location === 'undefined' ? '' : location.search): DevOptions {
  const params = new URLSearchParams(search);
  const set = typeof window === 'undefined' ? undefined : window.__OPENNOTE_DEV__;
  const fixture = set?.fixture ?? params.get('fixture');
  return {
    fixture: isFixtureName(fixture) ? fixture : undefined,
    pseudo: set?.pseudo ?? params.has('pseudo'),
  };
}
