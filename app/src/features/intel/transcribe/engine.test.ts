// The on-device transcript engine over the stand-in shell: it asks before turning transcription on, needs a
// downloaded model, sends the notebook's vocabulary, reports progress, and stops when asked.
import { beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import type { RecordingEntry } from '../../../core/audio';
import { fakeSpeechRequests, setFakeHearing } from '../../../platform/intelSpeech';
import { resetStores } from '../../../state/store';
import { loadIntel } from '../runtime';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import { saveVocabulary } from '../vocabulary/store';
import { transcribeOnDevice, TranscribeStopped } from './engine';
import { pickSpeechModel } from './model';

const ENTRY = {
  id: 'rec-1',
  state: 'finished',
  started: '2026-10-07T10:00:00Z',
  startedNs: 0,
  endedNs: 4e9,
  pauses: [],
  tracks: [],
} as unknown as RecordingEntry;

let host: TestHost;

async function install(id: string): Promise<void> {
  host.transport.ext.handle({ method: 'models.start', params: { id } });
  host.transport.ext.tick(1e9);
}

beforeEach(async () => {
  resetStores();
  initFlags('dev');
  setFakeHearing();
  host = installTestHost({ settings: { transcription: true } });
  await loadIntel();
});

describe('picking a speech model', () => {
  const list = (installed: string[]) => ({
    models: ['speech-tiny-en', 'speech-base-en', 'speech-small-en'].map((id) => ({
      id,
      kind: 'speech',
      name: id,
      detail: '',
      sizeBytes: 1,
      bytes: 1,
      error: null,
      state: installed.includes(id) ? ('installed' as const) : ('notInstalled' as const),
    })),
    lastRanUnix: null,
    offline: false,
  });

  it('prefers the chosen model, then the recommended one', () => {
    expect(pickSpeechModel(list(['speech-tiny-en', 'speech-base-en']), 'speech-tiny-en')).toBe('speech-tiny-en');
    expect(pickSpeechModel(list(['speech-tiny-en', 'speech-base-en']), null)).toBe('speech-base-en');
    expect(pickSpeechModel(list(['speech-small-en']), 'speech-tiny-en')).toBe('speech-small-en');
    expect(pickSpeechModel(list([]), null)).toBeNull();
    expect(pickSpeechModel(null, null)).toBeNull();
  });
});

describe('transcribing on this device', () => {
  it('returns the lines heard, with the notebook vocabulary sent along', async () => {
    await install('speech-tiny-en');
    await saveVocabulary(null, 'Krebs cycle\n');
    const progress: number[] = [];
    const result = await transcribeOnDevice({
      assetsDir: 'C:/notes/page/assets',
      entry: ENTRY,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(result.segments.map((line) => line.text)).toEqual(['The recording starts here.', 'And it ends here.']);
    expect(progress).toEqual([1]);
    expect(fakeSpeechRequests[0]).toMatchObject({ model: 'speech-tiny-en', choices: { vocabulary: 'Krebs cycle\n' } });
  });

  it('says a model is needed when none is downloaded', async () => {
    await expect(transcribeOnDevice({ assetsDir: 'x', entry: ENTRY })).rejects.toMatchObject({ reason: 'noModel' });
    expect(fakeSpeechRequests).toHaveLength(0);
  });

  it('does nothing in the background while transcription is off', async () => {
    host = installTestHost();
    await loadIntel();
    await install('speech-base-en');
    const error = await transcribeOnDevice({ assetsDir: 'x', entry: ENTRY }, { ask: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscribeStopped);
    expect((error as TranscribeStopped).reason).toBe('off');
  });

  it('stops when the signal aborts', async () => {
    await install('speech-base-en');
    const stop = new AbortController();
    const job = transcribeOnDevice({ assetsDir: 'x', entry: ENTRY, signal: stop.signal });
    stop.abort();
    await expect(job).rejects.toMatchObject({ reason: 'canceled' });
  });

  it('passes a failure on with its message', async () => {
    await install('speech-base-en');
    setFakeHearing(() => new Error('The audio could not be read.'));
    await expect(transcribeOnDevice({ assetsDir: 'x', entry: ENTRY })).rejects.toMatchObject({
      reason: 'failed',
      message: 'The audio could not be read.',
    });
  });
});
