// Model downloads for the interface (Phase 12). A model downloads only after the person saw its size and agreed. The
// shell does the work (app/src-tauri/src/intel/models.rs): it resumes, checks the checksum, and refuses while Work
// offline is on. This file keeps the list, asks first, and polls while something downloads.
import { toExtError } from '../../../services/intel';
import type { ExtErrorCode, ModelInfo, ModelList } from '../../../services/intel';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { confirm, showToast } from '../../../ui';
import { intelExt } from '../runtime';

export interface ModelsState {
  /** The last list the shell gave, or null before the first. */
  list: ModelList | null;
  /** Reading the list failed. */
  failed: boolean;
}

export const modelsState = createStore<ModelsState>({ list: null, failed: false }, 'intel models');

/** How often the list is read while a download runs. */
export const POLL_MS = 700;

const SIZE = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** A size in words people use: KB, MB, or GB. */
export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${SIZE.format(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${SIZE.format(bytes / 1e6)} MB`;
  return `${SIZE.format(Math.max(1, Math.round(bytes / 1e3)))} KB`;
}

/** Reads the list from the shell. A failure keeps the old list and says so. */
export async function refreshModels(): Promise<ModelList | null> {
  try {
    const list = await (await intelExt()).models.list();
    modelsState.set({ list, failed: false });
    return list;
  } catch {
    modelsState.set((state) => ({ ...state, failed: true }));
    return null;
  }
}

/** The sentence for a failed call. */
export function describeModelError(code: ExtErrorCode | 'canceled' | null): string {
  const known = code && code !== 'canceled' ? code : 'unknown';
  return t(`intelPlus.models.errors.${known}`);
}

/** The model with this ID in the last list. */
export function modelById(id: string): ModelInfo | undefined {
  return modelsState.get().list?.models.find((one) => one.id === id);
}

/** Starts or resumes a download without asking. A refusal, such as Work offline, is shown and returned as false. */
export async function startModel(id: string): Promise<boolean> {
  try {
    await (await intelExt()).models.start(id);
  } catch (error) {
    showToast({ message: describeModelError(toExtError(error).code), tone: 'danger' });
    return false;
  } finally {
    await refreshModels();
  }
  return true;
}

/**
 * Asks, with the size, and starts the download if the person agrees. A model that is partly downloaded resumes
 * without asking again, because the person already agreed to it.
 */
export async function downloadModel(model: ModelInfo): Promise<boolean> {
  if (model.state !== 'partial') {
    const yes = await confirm({
      title: t('intelPlus.models.confirmTitle', { name: model.name }),
      body: t('intelPlus.models.confirmBody', { size: formatSize(model.sizeBytes) }),
      confirmLabel: t('intelPlus.models.confirmYes'),
      cancelLabel: t('intelPlus.models.confirmNo'),
    });
    if (!yes) return false;
  }
  return startModel(model.id);
}

export async function cancelModel(id: string): Promise<void> {
  try {
    await (await intelExt()).models.cancel(id);
  } finally {
    await refreshModels();
  }
}

/** Deletes a model after the person confirms. */
export async function removeModel(model: ModelInfo): Promise<boolean> {
  const yes = await confirm({
    title: t('intelPlus.models.removeTitle', { name: model.name }),
    body: t('intelPlus.models.removeBody'),
    confirmLabel: t('intelPlus.models.removeYes'),
    cancelLabel: t('intelPlus.models.cancel'),
    danger: true,
  });
  if (!yes) return false;
  try {
    await (await intelExt()).models.remove(model.id);
  } catch (error) {
    showToast({ message: describeModelError(toExtError(error).code), tone: 'danger' });
  }
  await refreshModels();
  return true;
}

const SELECTED_FILE = 'speech-model.txt';

/** The speech model the person chose, or null. */
export async function selectedSpeechModel(): Promise<string | null> {
  try {
    const id = ((await (await intelExt()).get(SELECTED_FILE)) ?? '').trim();
    return id || null;
  } catch {
    return null;
  }
}

export async function chooseSpeechModel(id: string): Promise<void> {
  await (await intelExt()).put(SELECTED_FILE, id);
}

/** True while any model is downloading, so a screen knows to keep polling. */
export function anyDownloading(list: ModelList | null): boolean {
  return list?.models.some((one) => one.state === 'downloading') ?? false;
}
