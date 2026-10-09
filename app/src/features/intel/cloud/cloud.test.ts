// The person's own cloud key, feature by feature (A1-33): everything starts on this device, a key changes that only
// for its feature, the interface never holds the key after saving it, and Work offline keeps the input here.
import { beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import type { RecordingEntry } from '../../../core/audio';
import { fakeSpeechRequests, setFakeHearing } from '../../../platform/intelSpeech';
import { resetStores } from '../../../state/store';
import { loadIntel } from '../runtime';
import { cloudSummary, summarizeBlocks } from '../summary';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import { onDeviceTranscriptEngine, transcribeOnDevice } from '../transcribe/engine';
import { CHOICES_FILE, loadCloud, parseChoices, usesCloud } from './store';

const ENTRY = { id: 'rec-1', startedNs: 0, endedNs: 4e9, pauses: [], tracks: [] } as unknown as RecordingEntry;
// Built from pieces, so the source holds nothing shaped like a key.
const KEY = ['test', 'only', '0123456789', 'abcdef'].join('-');

let host: TestHost;

async function giveKey(feature: 'transcription' | 'summaries'): Promise<void> {
  host.transport.ext.handle({ method: 'cloud.setKey', params: { feature, key: KEY } });
  host.transport.ext.files.set(CHOICES_FILE, JSON.stringify({ [feature]: 'cloud' }));
  await loadCloud(true);
}

beforeEach(async () => {
  resetStores();
  initFlags('dev');
  setFakeHearing();
  host = installTestHost({ settings: { transcription: true, summaries: true } });
  await loadIntel();
});

describe('the choice of where a feature runs', () => {
  it('starts on this device, and reads anything unknown as this device', async () => {
    const state = await loadCloud(true);
    expect(state.where).toEqual({ transcription: 'device', summaries: 'device' });
    expect(parseChoices('{"summaries":"cloud","transcription":"elsewhere"}')).toEqual({
      transcription: 'device',
      summaries: 'cloud',
    });
    expect(parseChoices('not json')).toEqual({ transcription: 'device', summaries: 'device' });
  });

  it('needs both the choice and a saved key', async () => {
    host.transport.ext.files.set(CHOICES_FILE, JSON.stringify({ summaries: 'cloud' }));
    expect(usesCloud('summaries', await loadCloud(true))).toBe(false);
    await giveKey('summaries');
    expect(usesCloud('summaries')).toBe(true);
    expect(usesCloud('transcription')).toBe(false);
    // The status the interface holds says a key is there, and never what it is.
    expect(JSON.stringify(await loadCloud(true))).not.toContain(KEY);
  });

  it('refuses text that cannot be a key', () => {
    expect(() =>
      host.transport.ext.handle({ method: 'cloud.setKey', params: { feature: 'summaries', key: 'short' } }),
    ).toThrow();
    expect(() =>
      host.transport.ext.handle({ method: 'cloud.setKey', params: { feature: 'ocr', key: KEY } }),
    ).toThrow();
  });
});

describe('summaries with a key', () => {
  it('stay on this device without a key', async () => {
    expect(await cloudSummary('The cell makes energy. It uses sugar.')).toBeNull();
    expect(host.transport.ext.cloudSent).toEqual([]);
  });

  it('come from the service when chosen, and fall back here while Work offline is on', async () => {
    await giveKey('summaries');
    expect(await cloudSummary('The cell makes energy. It uses sugar.')).toEqual(['Summary: The cell makes energy.']);
    host.transport.ext.offline = true;
    expect(await cloudSummary('More notes.')).toBeNull();
    expect(host.transport.ext.cloudSent).toEqual(['The cell makes energy. It uses sugar.']);
    const page = await summarizeBlocks([{ text: 'The cell makes energy. It uses sugar.', reveal: () => undefined }], {
      ensureOn: async () => true,
    });
    expect(page?.sentences.length).toBeGreaterThan(0);
  });

  it('are not used when the flag is off', async () => {
    await giveKey('summaries');
    initFlags('dev', { 'intel.cloudKeys': false });
    expect(await cloudSummary('The cell makes energy.')).toBeNull();
  });
});

describe('transcription with a key', () => {
  it('runs on the service without a downloaded model, and says it is a cloud engine', async () => {
    await giveKey('transcription');
    expect(onDeviceTranscriptEngine.cloud).toBe(true);
    const result = await transcribeOnDevice({ assetsDir: 'C:/notes/page/assets', entry: ENTRY });
    expect(result.segments.length).toBe(2);
    expect(fakeSpeechRequests[0]).toMatchObject({ engine: 'cloud' });
  });

  it('runs on this device otherwise', async () => {
    expect(onDeviceTranscriptEngine.cloud).toBe(false);
  });
});
