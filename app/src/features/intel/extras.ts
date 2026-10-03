// The three features that read across the person's pages (Phase 12): search by meaning, ask your notes, and writing
// tools. Each stays off until the person turns it on, like the engines in IntelSettings, and each runs on this device
// with no network. Their switches are kept in this device's store, because they need no engine from the Rust crate.
import { createStore } from '../../state/store';
import { t } from '../../strings/t';
import { confirm, showToast } from '../../ui';
import { intelExt } from './runtime';

export const EXTRA_FEATURES = ['meaning', 'ask', 'writing'] as const;
export type ExtraFeature = (typeof EXTRA_FEATURES)[number];

export interface ExtrasState {
  loaded: boolean;
  on: Record<ExtraFeature, boolean>;
}

const OFF: Record<ExtraFeature, boolean> = { meaning: false, ask: false, writing: false };

export const extrasState = createStore<ExtrasState>({ loaded: false, on: OFF }, 'intel extras');

const FILE = 'extras.json';
let loading: Promise<void> | null = null;
const listeners = new Set<(feature: ExtraFeature, on: boolean) => void>();

/** Reads the switches once. A failure leaves everything off. */
export function loadExtras(): Promise<void> {
  loading ??= (async () => {
    let on = OFF;
    try {
      const text = await (await intelExt()).get(FILE);
      const saved = text ? (JSON.parse(text) as Partial<Record<ExtraFeature, unknown>>) : {};
      on = Object.fromEntries(EXTRA_FEATURES.map((one) => [one, saved[one] === true])) as typeof OFF;
    } catch {
      // Everything stays off.
    }
    extrasState.set({ loaded: true, on });
  })();
  return loading;
}

export function isExtraOn(feature: ExtraFeature): boolean {
  return extrasState.get().on[feature];
}

/** Calls back after a switch is saved, such as to start indexing. */
export function onExtraChange(listener: (feature: ExtraFeature, on: boolean) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Turns a feature on or off and saves it. A failed save puts the old choice back and rejects. */
export async function setExtra(feature: ExtraFeature, on: boolean): Promise<void> {
  await loadExtras();
  const before = extrasState.get().on;
  if (before[feature] === on) return;
  const next = { ...before, [feature]: on };
  extrasState.set({ loaded: true, on: next });
  try {
    await (await intelExt()).put(FILE, JSON.stringify(next));
  } catch (error) {
    extrasState.set({ loaded: true, on: before });
    throw error;
  }
  listeners.forEach((listener) => listener(feature, on));
}

/** Makes sure the feature is on, asking first when it is not. Resolves false when the person said not now. */
export async function askToTurnOnExtra(feature: ExtraFeature): Promise<boolean> {
  await loadExtras();
  if (isExtraOn(feature)) return true;
  const yes = await confirm({
    title: t('intelPlus.extras.offerTitle', { feature: t(`intelPlus.extras.${feature}.name`) }),
    body: `${t(`intelPlus.extras.${feature}.offer`)} ${t('intel.offer.where')}`,
    confirmLabel: t('intel.offer.turnOn'),
    cancelLabel: t('intel.offer.notNow'),
  });
  if (!yes) return false;
  try {
    await setExtra(feature, true);
  } catch {
    showToast({ message: t('intel.settings.status.saveFailed'), tone: 'danger' });
    return false;
  }
  return true;
}

/** Tests start over. */
export function resetExtrasForTests(): void {
  loading = null;
  listeners.clear();
  extrasState.set({ loaded: false, on: OFF });
}
