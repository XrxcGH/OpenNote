// Where each feature that could use a cloud service runs (A1-33): on this device, which is how everything starts, or
// with the person's own key for a cloud service. The choice is kept in this device's store. The key goes to the shell,
// which keeps it in Windows Credential Manager and never hands it back: the interface only learns that one is saved.
// A key is saved only after the person confirms what is sent, and where. While Work offline is on, nothing is sent:
// the feature runs on this device, or waits.
import { toExtError } from '../../../services/intel';
import type { CloudFeature, CloudStatus, IntelExt } from '../../../services/intel';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { confirm, showToast } from '../../../ui';
import { intelExt } from '../runtime';

export type EngineWhere = 'device' | 'cloud';

export const CLOUD_FEATURES: readonly CloudFeature[] = ['transcription', 'summaries'];

export interface CloudState {
  where: Record<CloudFeature, EngineWhere>;
  /** What the shell says about each feature's key, or null before the first answer. */
  status: CloudStatus[] | null;
}

const DEVICE_ONLY: Record<CloudFeature, EngineWhere> = { transcription: 'device', summaries: 'device' };
export const CHOICES_FILE = 'cloud-choices.json';

export const cloudState = createStore<CloudState>({ where: { ...DEVICE_ONLY }, status: null }, 'intel cloud');

/** The saved choices, with anything unknown read as "on this device". */
export function parseChoices(text: string | null): Record<CloudFeature, EngineWhere> {
  const where = { ...DEVICE_ONLY };
  if (!text) return where;
  try {
    const saved = JSON.parse(text) as Record<string, unknown>;
    for (const feature of CLOUD_FEATURES) if (saved[feature] === 'cloud') where[feature] = 'cloud';
  } catch {
    // A file that can't be read leaves everything on this device, which is the safe answer.
  }
  return where;
}

let loading: { ext: IntelExt; promise: Promise<CloudState> } | null = null;

/** Reads the choices and the key status once for this platform's store; `refresh` reads them again. */
export async function loadCloud(refresh = false): Promise<CloudState> {
  const ext = await intelExt();
  if (loading && loading.ext === ext && !refresh) return loading.promise;
  const promise = (async () => {
    const [text, status] = await Promise.all([
      ext.get(CHOICES_FILE).catch(() => null),
      ext.cloud.status().catch(() => null),
    ]);
    cloudState.set({ where: parseChoices(text), status });
    return cloudState.get();
  })();
  loading = { ext, promise };
  return promise;
}

export function hasKey(feature: CloudFeature, state: CloudState = cloudState.get()): boolean {
  return state.status?.some((one) => one.feature === feature && one.hasKey) ?? false;
}

/** Whether the feature runs on the cloud service: the person chose it, and a key is saved. */
export function usesCloud(feature: CloudFeature, state: CloudState = cloudState.get()): boolean {
  return state.where[feature] === 'cloud' && hasKey(feature, state);
}

/** The host a feature's input goes to with its key. */
export function hostOf(feature: CloudFeature, state: CloudState = cloudState.get()): string {
  return state.status?.find((one) => one.feature === feature)?.host ?? 'api.openai.com';
}

async function saveWhere(where: Record<CloudFeature, EngineWhere>): Promise<void> {
  await (await intelExt()).put(CHOICES_FILE, JSON.stringify(where));
  cloudState.set((state) => ({ ...state, where }));
}

/** Runs a feature on this device again. The key stays saved until the person forgets it. */
export async function chooseDevice(feature: CloudFeature): Promise<void> {
  await saveWhere({ ...cloudState.get().where, [feature]: 'device' });
}

/**
 * Saves the person's key for a feature and runs the feature with it, after they confirm what is sent and where.
 * Returns false when they said no or the key was refused; the reason is shown.
 */
export async function saveCloudKey(feature: CloudFeature, key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const yes = await confirm({
    title: t('intelSpeech.cloud.confirmTitle'),
    body: t(`intelSpeech.cloud.confirmBody.${feature}`, { host: hostOf(feature) }),
    confirmLabel: t('intelSpeech.cloud.confirm'),
    cancelLabel: t('intelSpeech.cloud.keepOnDevice'),
  });
  if (!yes) return false;
  try {
    await (await intelExt()).cloud.setKey(feature, trimmed);
  } catch (error) {
    const code = toExtError(error).code;
    showToast({
      message: t(code === 'invalid' ? 'intelSpeech.cloud.badKey' : 'intelSpeech.cloud.storeFailed'),
      tone: 'danger',
    });
    return false;
  }
  await saveWhere({ ...cloudState.get().where, [feature]: 'cloud' });
  await loadCloud(true);
  showToast({ message: t('intelSpeech.cloud.saved') });
  return true;
}

/** Deletes the key from Windows Credential Manager and runs the feature on this device. */
export async function forgetCloudKey(feature: CloudFeature): Promise<void> {
  try {
    await (await intelExt()).cloud.forget(feature);
  } catch {
    showToast({ message: t('intelSpeech.cloud.storeFailed'), tone: 'danger' });
    return;
  }
  await saveWhere({ ...cloudState.get().where, [feature]: 'device' });
  await loadCloud(true);
  showToast({ message: t('intelSpeech.cloud.forgotten') });
}
