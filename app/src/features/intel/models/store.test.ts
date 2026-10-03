import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../../../state/store';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import {
  anyDownloading,
  cancelModel,
  chooseSpeechModel,
  formatSize,
  modelById,
  modelsState,
  refreshModels,
  selectedSpeechModel,
  startModel,
} from './store';

let host: TestHost;
beforeEach(() => {
  resetStores();
  host = installTestHost();
});

describe('sizes', () => {
  it('uses the words people use', () => {
    expect(formatSize(77_704_715)).toBe('77.7 MB');
    expect(formatSize(487_614_201)).toBe('487.6 MB');
    expect(formatSize(1_500_000_000)).toBe('1.5 GB');
    expect(formatSize(4200)).toBe('4 KB');
  });
});

describe('downloads', () => {
  it('lists the models with their sizes before anything downloads', async () => {
    const list = await refreshModels();
    expect(list?.models.map((model) => model.state)).toEqual(['notInstalled', 'notInstalled', 'notInstalled']);
    expect(modelById('speech-base-en')?.sizeBytes).toBe(147_964_211);
    expect(host.transport.ext.calls).toEqual(['models.list']);
  });

  it('shows progress, then installed', async () => {
    await startModel('speech-base-en');
    expect(anyDownloading(modelsState.get().list)).toBe(true);
    host.transport.ext.tick(50_000_000);
    await refreshModels();
    expect(modelById('speech-base-en')).toMatchObject({ state: 'downloading', bytes: 50_000_000 });
    host.transport.ext.tick(1e9);
    await refreshModels();
    expect(modelById('speech-base-en')?.state).toBe('installed');
    expect(anyDownloading(modelsState.get().list)).toBe(false);
  });

  it('keeps the part when canceled so the next start resumes', async () => {
    await startModel('speech-base-en');
    host.transport.ext.tick(1000);
    await cancelModel('speech-base-en');
    expect(modelById('speech-base-en')).toMatchObject({ state: 'partial', bytes: 1000 });
    await startModel('speech-base-en');
    expect(modelById('speech-base-en')?.bytes).toBe(1000);
  });

  it('does not start while Work offline is on', async () => {
    host.transport.ext.offline = true;
    expect(await startModel('speech-base-en')).toBe(false);
    expect(modelById('speech-base-en')?.state).toBe('notInstalled');
    expect(modelsState.get().list?.offline).toBe(true);
  });
});

describe('the chosen speech model', () => {
  it('is remembered on this device', async () => {
    expect(await selectedSpeechModel()).toBeNull();
    await chooseSpeechModel('speech-tiny-en');
    expect(await selectedSpeechModel()).toBe('speech-tiny-en');
  });
});
