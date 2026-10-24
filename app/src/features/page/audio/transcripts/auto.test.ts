// Every recording gets a transcript and summary. A saved recording queues a background job only after the person
// turned it on. The transcript and summary land after the recording. A cloud engine waits out Work offline.
// The choice is kept on this device.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../../app/flags';
import type { RecordingEntry } from '../../../../core/audio';
import { createMemoryPageService } from '../../../../services/pages/memory';
import type { MemoryPageService } from '../../../../services/pages/memory';
import { loadApi, loadTesting } from '../../../intel';
import { textPageFixture } from '../../test/fixtures';
import { autoTranscripts, loadAutoTranscripts, recordingSaved, setAutoDepsForTests, setAutoTranscripts } from './auto';
import type { AutoDeps } from './auto';
import { registerTranscriptEngine } from './engine';
import type { TranscriptEngine } from './engine';
import { transcriptsOf } from './store';

const ENTRY = {
  id: 'rec-1',
  state: 'finished',
  started: '2026-10-07T10:00:00Z',
  startedNs: 0,
  endedNs: 4e9,
  pauses: [],
  tracks: [],
} as unknown as RecordingEntry;

const fixture = textPageFixture('Lecture notes');
const PAGE = fixture.page.id;
const HOLDER = fixture.page.blocks[0]!.id;

type TestHost = Awaited<ReturnType<Awaited<ReturnType<typeof loadTesting>>['installTestHost']>>;
let host: TestHost;
let service: MemoryPageService;
let jobs: { id: string; label: string; automatic: boolean }[];
let offline: boolean;
let goOnline: (() => void) | null;
let summarized: number;
let unregister: (() => void) | undefined;

const stubEngine = (cloud = false): TranscriptEngine => ({
  id: 'stub',
  cloud,
  transcribe: () =>
    Promise.resolve({
      language: 'en',
      segments: [
        { startMs: 0, endMs: 2000, text: 'The cell makes energy.' },
        { startMs: 2000, endMs: 4000, text: 'Mitochondria do the work.' },
      ],
    }),
});

function deps(): AutoDeps {
  return {
    assetsDir: () => Promise.resolve('C:/notes/page/assets'),
    pages: () => service,
    placeShown: () => Promise.resolve(false),
    summarize: () => {
      summarized += 1;
      return Promise.resolve('The cell makes energy.');
    },
    isOffline: () => offline,
    watchOnline: (then) => {
      goOnline = then;
      return () => (goOnline = null);
    },
    async enqueue(spec) {
      jobs.push({ id: spec.id, label: spec.label, automatic: spec.automatic });
      await spec.run(new AbortController().signal);
      return true;
    },
    intelOn: async () => (await loadApi()).isOn('transcription'),
  };
}

async function heldTranscripts() {
  return transcriptsOf(service.held(PAGE)?.view);
}

beforeEach(async () => {
  initFlags('dev');
  host = (await loadTesting()).installTestHost({ settings: { transcription: true } });
  await (await loadApi()).loadIntel();
  service = createMemoryPageService([fixture]);
  jobs = [];
  offline = false;
  goOnline = null;
  summarized = 0;
  setAutoDepsForTests(deps());
  unregister = registerTranscriptEngine(stubEngine());
  // The first test loads the intel feature, which takes a while in a cold browser.
}, 60_000);

afterEach(() => {
  unregister?.();
  setAutoDepsForTests(null);
});

describe('a transcript and summary for every recording', () => {
  it('does nothing until the person turns it on', async () => {
    expect(await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY })).toBe(false);
    expect(jobs).toEqual([]);
  });

  it('queues a background job and places the transcript with its summary after the recording', async () => {
    await setAutoTranscripts(true);
    expect(await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY, label: 'lecture.mp3' })).toBe(true);
    expect(jobs).toEqual([{ id: 'transcript-rec-1', label: 'Transcript of lecture.mp3', automatic: true }]);
    const [placed] = await heldTranscripts();
    expect(placed?.summary).toBe('The cell makes energy.');
    expect(placed?.lines.map((line) => line.text)).toEqual(['The cell makes energy.', 'Mitochondria do the work.']);
    const blocks = service.held(PAGE)!.blocks;
    expect(blocks.map((block) => block.type)).toEqual(['text', 'ext:org.opennote/transcript']);
  });

  it('keeps a transcript that is already there', async () => {
    await setAutoTranscripts(true);
    await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY });
    await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY });
    expect(service.held(PAGE)!.blocks.filter((block) => block.type !== 'text')).toHaveLength(1);
  });

  it('leaves recordings alone while transcription is off', async () => {
    host = (await loadTesting()).installTestHost();
    await (await loadApi()).loadIntel();
    await setAutoTranscripts(true);
    expect(await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY })).toBe(false);
    expect(jobs).toEqual([]);
  });

  it('leaves recordings alone when the flag is off', async () => {
    initFlags('dev', { 'intel.autoTranscripts': false });
    await setAutoTranscripts(true);
    expect(await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY })).toBe(false);
  });

  it('holds a cloud engine’s job while Work offline is on, and queues it after', async () => {
    unregister?.();
    unregister = registerTranscriptEngine(stubEngine(true));
    offline = true;
    await setAutoTranscripts(true);
    expect(await recordingSaved({ page: PAGE, block: HOLDER, entry: ENTRY })).toBe(true);
    expect(jobs).toEqual([]);
    offline = false;
    goOnline?.();
    await vi.waitFor(() => expect(jobs).toHaveLength(1));
    await vi.waitFor(async () => expect(await heldTranscripts()).toHaveLength(1));
  });

  it('keeps the choice on this device', async () => {
    await setAutoTranscripts(true);
    expect(host.transport.ext.files.get('auto-transcripts.json')).toBe('{"on":true}');
    setAutoDepsForTests(deps());
    expect(autoTranscripts.get()).toBe(false);
    await loadAutoTranscripts();
    expect(autoTranscripts.get()).toBe(true);
    expect(summarized).toBe(0);
  });
});
