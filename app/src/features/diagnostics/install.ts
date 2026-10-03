// Start-up for the diagnostics feature (docs/HARDENING.md). It reads what the host kept: the privacy choices, the
// consent, and how the last sessions ended. If the last two sessions both ended in a crash, it shows the safe start
// offer before the notebook opens. Later, and only when nothing else is in the way, it shows the consent screen once.

import { isEnabled } from '../../app/flags';
import { getLocation, onNavigate } from '../../app/location';
import type { Platform } from '../../platform/types';
import { prompt } from './consent';
import { openSafeStart } from './safeStart';
import { consentStore, refreshPrivacy, safeModeStore } from './runtime';
import type { Startup } from './types';

/** What start-up assumes when the host can't say: a normal start after a clean session. */
const NORMAL_START: Startup = {
  report: { previous: 'clean', crashesInARow: 0, offerSafeMode: false, previousWasSafe: false },
  safeMode: false,
  stats: { sessions: 0, clean: 0, crashed: 0 },
};

/** How long after start the consent screen waits, so it never competes with the first paint. */
const CONSENT_DELAY_MS = 1200;

/**
 * Offers safe mode when the last two starts crashed. Resolves when the person has chosen, or at once when there
 * is nothing to offer. Call it after the commands are configured and before the first screen renders.
 */
export async function offerSafeStart(platform: Platform): Promise<void> {
  if (!isEnabled('diagnostics.safeStart')) return;
  const startup: Startup = await platform.diagnostics.startup().catch(() => NORMAL_START);
  safeModeStore.set(startup.safeMode);
  const flow = openSafeStart(startup.report);
  if (!flow) return;
  // The window may still be hidden, and the offer needs it.
  platform.lifecycle.firstPaint();
  const { mountSafeStart } = await import('./dialogs');
  const choice = await mountSafeStart(flow);
  if (choice !== 'safe') return;
  try {
    await platform.diagnostics.enterSafeMode();
    safeModeStore.set(true);
  } catch {
    // The offer was not taken up, so this session runs normally.
  }
}

/** Fills the stores, and asks for consent once on the beta channel when the person has not been asked. */
export function installDiagnostics(platform: Platform): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopNavigation = () => {};
  const askWhenClear = () => {
    if (stopped || !isEnabled('diagnostics.crashReports')) return;
    const reason = prompt(consentStore.get());
    if (reason === 'none') return;
    const view = getLocation().view;
    if (view === 'setup') return;
    void import('./openers').then(({ showConsent }) => showConsent(reason === 'first' ? 'first' : 'reworded'));
    stopNavigation();
  };
  void refreshPrivacy(platform.diagnostics).then(() => {
    if (stopped || platform.boot.channel !== 'beta') return;
    // Setup may be showing; the screen waits until it is gone.
    stopNavigation = onNavigate(() => {
      clearTimeout(timer);
      timer = setTimeout(askWhenClear, CONSENT_DELAY_MS);
    });
    timer = setTimeout(askWhenClear, CONSENT_DELAY_MS);
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopNavigation();
  };
}
