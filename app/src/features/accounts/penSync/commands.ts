// Sync pen settings: the pens, their colors, and the drawing bar's choices follow the person to their other devices, through
// a small file in the app folder of the cloud account that is linked (Google or Microsoft). The first sync asks which
// account when both are linked; after that the sync runs by itself while the app is open, with no message.
import { getSettings, updateSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { connectors } from '../../connectors';
import { inkPrefs, setInkPrefs } from '../../ink';
import type { InkPrefs } from '../../ink';
import { accountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { loadState, saveState } from '../state';
import { pickOne } from '../ui/prompts';
import { channelFor } from './channel';
import type { PenService } from './channel';
import { PREF_KEYS } from './items';
import type { Patches, PenState } from './items';
import { EMPTY_SYNC } from './merge';
import type { PenSyncState } from './merge';
import { syncPenSettings } from './sync';
import type { PenDevice } from './sync';

const NAMES: Record<PenService, string> = { google: 'Google', microsoft: 'Microsoft' };
const CHOICE = 'pensync';
const stateName = (service: PenService): string => `pensync.${service}`;

/** This device's pen settings, from the settings and the ink preferences. */
export function thisDevice(): PenDevice {
  return {
    read(): PenState {
      const settings = getSettings();
      const prefs = inkPrefs.get();
      return {
        pens: settings.ink.pens,
        formattingBar: settings.editing.formattingBar,
        handedness: settings.ink.handedness,
        prefs: Object.fromEntries(PREF_KEYS.map((key) => [key, prefs[key]])) as PenState['prefs'],
      };
    },
    async apply(patches: Patches) {
      const patch: Record<string, Record<string, unknown>> = {};
      if (patches.pens) patch.ink = { ...patch.ink, pens: patches.pens };
      if (patches.handedness) patch.ink = { ...patch.ink, handedness: patches.handedness };
      if (patches.formattingBar) patch.editing = { formattingBar: patches.formattingBar };
      if (Object.keys(patch).length > 0) await updateSettings(patch as Parameters<typeof updateSettings>[0]);
      if (patches.prefs) setInkPrefs(patches.prefs as Partial<InkPrefs>);
    },
  };
}

/** The account the pen settings go through: the one chosen before, else the one linked, else the person chooses. */
async function serviceToUse(): Promise<PenService | null> {
  const host = accountsHost();
  const linked: PenService[] = [];
  for (const service of ['google', 'microsoft'] as const) if (await isConnected(service)) linked.push(service);
  const saved = (await loadState<{ service: PenService | null }>(CHOICE, { service: null }, host)).service;
  if (saved && linked.includes(saved)) return saved;
  if (linked.length === 0) return null;
  if (linked.length === 1) return linked[0] ?? null;
  const chosen = await pickOne<PenService>({
    title: t('accounts.penSync.pick.title'),
    description: t('accounts.penSync.pick.description'),
    confirmLabel: t('accounts.penSync.pick.confirm'),
    choices: linked.map((service) => ({ id: service, label: NAMES[service], value: service })),
  });
  if (chosen) await saveState(CHOICE, { service: chosen }, host);
  return chosen;
}

/** One sync, saved. Throws what the service says. */
export async function runPenSync(service: PenService) {
  const host = accountsHost();
  const state = await loadState<PenSyncState>(stateName(service), EMPTY_SYNC, host);
  const done = await syncPenSettings(channelFor(service, connectors()), thisDevice(), state);
  await saveState(stateName(service), done.state, host);
  return done.result;
}

/** The service the quiet sync uses, or null when pen settings have not been synced on this device. */
export async function syncedService(): Promise<PenService | null> {
  const saved = (await loadState<{ service: PenService | null }>(CHOICE, { service: null }, accountsHost())).service;
  return saved && (await isConnected(saved)) ? saved : null;
}

export async function syncNow(): Promise<void> {
  const service = await serviceToUse();
  if (!service) return tellNotConnected(`${NAMES.google} or ${NAMES.microsoft}`);
  await attempt(NAMES[service], async () => {
    announce(t('accounts.penSync.working', { service: NAMES[service] }));
    const result = await runPenSync(service);
    const message =
      result.pushed + result.pulled === 0
        ? t('accounts.penSync.upToDate')
        : t('accounts.penSync.done', { pushed: result.pushed, pulled: result.pulled });
    showToast({ message });
    announce(message);
  });
}

/** Stops the syncing on this device. The file at the service stays, and other devices keep using it. */
export async function turnOff(): Promise<void> {
  await saveState(CHOICE, { service: null }, accountsHost());
  showToast({ message: t('accounts.penSync.off') });
}
