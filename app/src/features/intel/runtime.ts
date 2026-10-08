// The intel client for the running app, and the person's choices (Phase 12). Every feature is off until the person
// turns it on. A feature that is off is never run: the Rust crate refuses it, and the interface offers to turn it on
// first (askToTurnOn). Nothing here touches a network.
import { commandContext } from '../../commands/registry';
import { loadIntelHost } from '../../platform/intel';
import type { IntelHost } from '../../platform/intel';
import { createIntelClient, createIntelExt, isIntelError, toIntelError } from '../../services/intel';
import type { Feature, IntelClient, IntelExt } from '../../services/intel';
import { t } from '../../strings/t';
import { confirm, showToast } from '../../ui';
import { intelState, isOn, OFF } from './choices';

/** The features this phase's interface offers. Transcription is Phase 9's. */
export const ON_DEVICE_FEATURES = ['ocr', 'handwriting', 'readAloud', 'summaries', 'transcription'] as const;
export type OnDeviceFeature = (typeof ON_DEVICE_FEATURES)[number];

let hostPromise: Promise<IntelHost> | null = null;
let clientPromise: Promise<IntelClient> | null = null;
let extPromise: Promise<IntelExt> | null = null;
let loading: Promise<void> | null = null;

function host(): Promise<IntelHost> {
  hostPromise ??= loadIntelHost();
  return hostPromise;
}

/** The client for this platform, made on first use. */
export function intelClient(): Promise<IntelClient> {
  clientPromise ??= host().then((one) => createIntelClient(one.transport));
  return clientPromise;
}

/** The device store and model downloads for this platform, made on first use. */
export function intelExt(): Promise<IntelExt> {
  extPromise ??= host().then((one) => createIntelExt(one.transport));
  return extPromise;
}

/** Reads the saved choices once. A failure leaves everything off, which is the safe answer. */
export function loadIntel(): Promise<void> {
  loading ??= host()
    .then((one) => one.loadChoices())
    .then(
      (choices) => intelState.set((state) => ({ ...state, loaded: true, failed: false, choices })),
      () => intelState.set((state) => ({ ...state, loaded: true, failed: true })),
    );
  return loading;
}

/** Asks what each feature needs to run here. A feature that is on and has no language pack or voice says so. */
export async function refreshStatus(): Promise<void> {
  try {
    const status = await (await intelClient()).status();
    intelState.set((state) => ({ ...state, status }));
  } catch {
    intelState.set((state) => ({ ...state, status: null }));
  }
}

const listeners = new Set<(feature: Feature, on: boolean) => void>();

/** Calls back after a choice is saved, such as for read aloud to start over with the other engine. */
export function onChoiceChange(listener: (feature: Feature, on: boolean) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Turns a feature on or off. The choice shows at once, and a failed save puts the old one back. */
export async function setFeature(feature: Feature, on: boolean): Promise<void> {
  await loadIntel();
  const before = intelState.get().choices;
  if (before[feature] === on) return;
  intelState.set((state) => ({ ...state, choices: { ...state.choices, [feature]: on } }));
  try {
    const saved = await (await host()).saveChoices({ [feature]: on });
    intelState.set((state) => ({ ...state, choices: saved }));
  } catch (error) {
    intelState.set((state) => ({ ...state, choices: before }));
    throw error;
  }
  listeners.forEach((listener) => listener(feature, on));
  void refreshStatus();
}

/**
 * Makes sure the feature is on, asking the person first when it is not. Resolves true when it is on, and false when
 * the person said not now. Background work never calls this: it skips a feature that is off.
 */
export async function askToTurnOn(feature: OnDeviceFeature): Promise<boolean> {
  await loadIntel();
  if (isOn(feature)) return true;
  const name = t(FEATURE_NAME[feature]);
  const yes = await confirm({
    title: t('intel.offer.title', { feature: name }),
    body: `${t(OFFER_BODY[feature])} ${t('intel.offer.where')}`,
    confirmLabel: t('intel.offer.turnOn'),
    cancelLabel: t('intel.offer.notNow'),
  });
  if (!yes) return false;
  try {
    await setFeature(feature, true);
  } catch {
    showToast({ message: t('intel.settings.status.saveFailed'), tone: 'danger' });
    return false;
  }
  return true;
}

const FEATURE_NAME = {
  ocr: 'intel.features.ocr',
  handwriting: 'intel.features.handwriting',
  readAloud: 'intel.features.readAloud',
  summaries: 'intel.features.summaries',
  transcription: 'intel.features.transcription',
} as const satisfies Record<OnDeviceFeature, `intel.features.${OnDeviceFeature}`>;

const OFFER_BODY = {
  ocr: 'intel.offer.ocr',
  handwriting: 'intel.offer.handwriting',
  readAloud: 'intel.offer.readAloud',
  summaries: 'intel.offer.summaries',
  transcription: 'intel.offer.transcription',
} as const satisfies Record<OnDeviceFeature, `intel.offer.${OnDeviceFeature}`>;

function openWindowsSettings(page: 'speech' | 'language'): void {
  void commandContext('menu')
    .platform.shell.openExternal({ kind: 'windowsSettings', page })
    .catch(() => undefined);
}

/** What a failed call tells the person, in the words of the interface: what is missing and where to add it. */
export function describeProblem(
  error: unknown,
  kind: 'image' | 'handwriting' | 'speech' | 'text',
): { message: string; action?: { label: string; run(): void } } {
  const failure = toIntelError(error);
  if (failure.code === 'voiceUnavailable') {
    return {
      message: t('intel.problems.voiceUnavailable'),
      action: { label: t('intel.settings.openSpeechSettings'), run: () => openWindowsSettings('speech') },
    };
  }
  if (failure.code === 'languageUnavailable') {
    const handwriting = kind === 'handwriting';
    return {
      message: t(handwriting ? 'intel.problems.handwritingUnavailable' : 'intel.problems.languageUnavailable'),
      action: { label: t('intel.settings.openLanguageSettings'), run: () => openWindowsSettings('language') },
    };
  }
  if (failure.code === 'unsupported') return { message: t('intel.problems.unsupported') };
  return { message: t('intel.problems.failed') };
}

/** Shows `describeProblem` as a toast. A feature that is off is offered, not reported. */
export function reportProblem(error: unknown, kind: 'image' | 'handwriting' | 'speech' | 'text'): void {
  if (isIntelError(error, 'canceled')) return;
  const { message, action } = describeProblem(error, kind);
  showToast({ message, ...(action ? { action } : {}), tone: 'danger' });
}

/** Tests give the client a host of their own, and start over. */
export function resetIntelForTests(next: IntelHost | null = null): void {
  hostPromise = next ? Promise.resolve(next) : null;
  clientPromise = null;
  extPromise = null;
  loading = null;
  listeners.clear();
  intelState.set({ loaded: false, choices: OFF, status: null, failed: false });
}
