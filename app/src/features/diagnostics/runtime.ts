// What the screens share: the host client, and the few facts that more than one screen shows or changes. The
// stores fill at start-up (install.ts) and follow the commands that change them.

import { commandContext } from '../../commands/registry';
import { createStore, useStore } from '../../state/store';
import type { DiagnosticsClient } from './client';
import { UNASKED } from './consent';
import type { Consent, PrivacyState } from './types';

/** The host's diagnostics client. */
export function diagnostics(): DiagnosticsClient {
  return commandContext('menu').platform.diagnostics;
}

/** Whether this session runs in safe mode. Other features that safe mode turns off read this. */
export const safeModeStore = createStore<boolean>(false, 'diagnostics safe mode');
export const isSafeMode = (): boolean => safeModeStore.get();
const same = <T>(value: T): T => value;
const offlineOf = (state: PrivacyState): boolean => state.workOffline;
export const useSafeMode = (): boolean => useStore(safeModeStore, same);

const NO_PRIVACY: PrivacyState = { workOffline: false, reportEndpoint: '', reportSentUnix: null };
export const privacyStore = createStore<PrivacyState>(NO_PRIVACY, 'diagnostics privacy');
export const consentStore = createStore<Consent>(UNASKED, 'diagnostics consent');

/** Whether the person turned on Work offline. Network uses in the interface read this too. */
export const isOffline = (): boolean => privacyStore.get().workOffline;
export const useOffline = (): boolean => useStore(privacyStore, offlineOf);
export const usePrivacy = (): PrivacyState => useStore(privacyStore, same);
export const useConsent = (): Consent => useStore(consentStore, same);

/** Counts the changes made here, so a read that started before a change cannot undo it. */
let changes = 0;

/** Records a change the person made. The host has already accepted it. */
export function changePrivacy(patch: Partial<PrivacyState>): void {
  changes += 1;
  privacyStore.set((state) => ({ ...state, ...patch }));
}

/** Records a new consent decision. The host has already accepted it. */
export function changeConsent(consent: Consent): void {
  changes += 1;
  consentStore.set(consent);
}

/** Reads the host's privacy choices and consent into the stores. A failure leaves the defaults. */
export async function refreshPrivacy(client: DiagnosticsClient = diagnostics()): Promise<void> {
  const before = changes;
  const [privacy, consent] = await Promise.all([
    client.privacy().catch(() => null),
    client.consent().catch(() => null),
  ]);
  if (changes !== before) return;
  if (privacy) privacyStore.set(privacy);
  if (consent) consentStore.set(consent);
}
