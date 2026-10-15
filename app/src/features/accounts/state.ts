// What a sync remembers between runs, kept by the host in this device's folder (accounts_call state.*): a cursor, a
// delta link, the IDs of copies at a service, a conflict log. Nothing here is a token. A name is lowercase letters,
// digits, dots, and dashes. Reading never throws: a missing or damaged file reads as the fallback.

import { accountsHost } from './host';
import type { AccountsHost } from './host';

/** The saved value with the fallback's keys filled in, or the fallback. */
export async function loadState<T extends object>(
  name: string,
  fallback: T,
  host: AccountsHost = accountsHost(),
): Promise<T> {
  try {
    const saved = await host.stateGet<Partial<T>>(name);
    const merged = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...fallback, ...saved } : fallback;
    // A copy, so a sync that changes what it loaded never changes the fallback or the host's own copy.
    return structuredClone(merged);
  } catch {
    return structuredClone(fallback);
  }
}

export async function saveState(name: string, value: unknown, host: AccountsHost = accountsHost()): Promise<void> {
  await host.stateSet(name, value);
}

export async function forgetState(name: string, host: AccountsHost = accountsHost()): Promise<void> {
  await host.stateDelete(name);
}
