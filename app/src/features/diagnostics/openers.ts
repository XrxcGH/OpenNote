// The ways in to the diagnostics screens. Each loads the dialogs the first time it is used. Sections of Settings
// and commands call these; nothing here runs at start-up.

import { navigate } from '../../app/location';
import type { ConsentFlow } from './consent';

export async function showConsent(reason: ConsentFlow['reason']): Promise<void> {
  (await import('./dialogs')).mountConsent(reason);
}

export async function showReview(id: string): Promise<void> {
  (await import('./dialogs')).mountReview(id);
}

export async function showFeedback(): Promise<void> {
  (await import('./dialogs')).mountFeedback();
}

/** Settings, then Help, where Check OpenNote runs. */
export function openHelp(): void {
  navigate({ view: 'settings', section: 'help' });
}

/** Settings, then Privacy. */
export function openPrivacy(): void {
  navigate({ view: 'settings', section: 'privacy' });
}
