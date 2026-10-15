// Every recording gets a transcript and a summary (A1-4). When a recording stops, or an audio file dropped on a page
// becomes one, a job goes into the background queue, and when it finishes the transcript block, with its summary at
// the top, is placed after the recording. It happens only after the person turned it on, only while transcription is
// on, never for a recording that already has a transcript, and it waits while Work offline is on if the speech engine
// is a cloud one. The person's choice is kept on this device, in the shell's device store.
import { isEnabled } from '../../../../app/flags';
import { extrasOf, playable } from '../../../../core/audio';
import type { RecordingEntry } from '../../../../core/audio';
import { newId } from '../../../../editor/ids';
import type { BlockId, Edit, NewBlock, PageService } from '../../../../services/pages/types';
import { createStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { announce, showToast } from '../../../../ui';
import { currentEngine } from './engine';
import { fromSegments } from './model';
import type { TranscriptData } from './model';
import { TRANSCRIPT_TYPE } from './moment';
import { fallbackOf, transcriptsOf } from './store';

/** A recording that was just saved on a page. */
export interface SavedRecording {
  page: string;
  /** The recording's block. */
  block: BlockId;
  entry: RecordingEntry;
  /** What the person sees in the activity panel, such as the file's name. */
  label?: string;
}

/** What a job needs from the rest of the app. Tests hand in their own. */
export interface AutoDeps {
  assetsDir(page: string): Promise<string>;
  pages(): PageService;
  /** Puts the transcript on the shown page when that page is `page`, and says whether it did. */
  placeShown(page: string, holder: BlockId, data: TranscriptData): Promise<boolean>;
  summarize(data: TranscriptData): Promise<string | null>;
  isOffline(): boolean;
  /** Calls `then` each time Work offline may have ended. Returns a function that stops. */
  watchOnline(then: () => void): () => void;
  /** Adds a background job. False when it was left out, as in on-request mode. */
  enqueue(spec: {
    id: string;
    kind: 'transcription';
    label: string;
    automatic: true;
    run(signal: AbortSignal): Promise<void>;
  }): Promise<boolean>;
  intelOn(): Promise<boolean>;
}

const FILE = 'auto-transcripts.json';

/** Whether the person turned on transcripts for every recording. Off until they do. */
export const autoTranscripts = createStore<boolean>(false, 'auto transcripts');

let loaded: Promise<void> | null = null;

const intelExt = async () => (await (await import('../../../intel')).loadApi()).intelExt();

/** Reads the person's choice once. */
export function loadAutoTranscripts(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await (await intelExt()).get(FILE);
      const saved = text ? (JSON.parse(text) as { on?: unknown }) : null;
      autoTranscripts.set(saved?.on === true);
    } catch {
      // Off stays.
    }
  })();
  return loaded;
}

/** Turns transcripts for every recording on or off, and keeps the choice on this device. */
export async function setAutoTranscripts(on: boolean): Promise<void> {
  autoTranscripts.set(on);
  try {
    await (await intelExt()).put(FILE, JSON.stringify({ on }));
  } catch {
    // The choice lasts until the app closes.
  }
}

async function realDeps(): Promise<AutoDeps> {
  const [{ platformAudio }, runtime, privacy, api, actions, shown, store] = await Promise.all([
    import('../controller'),
    import('../../runtime'),
    import('../../../diagnostics'),
    import('../../../intel').then((module) => module.loadApi()),
    import('./actions'),
    import('../../history/shown'),
    import('./store'),
  ]);
  return {
    assetsDir: (page) => platformAudio().assetsDir(page),
    pages: () => runtime.pagesClient(),
    async placeShown(page, holder, data) {
      if (shown.shownPage.get()?.id !== page) return false;
      if (store.transcriptOf(data.recording)) return true;
      await store.addTranscript(data, holder);
      return true;
    },
    summarize: (data) => actions.quietSummary(data),
    isOffline: privacy.isOffline,
    watchOnline: (then) => privacy.privacyStore.subscribe(() => !privacy.isOffline() && then()),
    enqueue: (spec) => api.enqueueBackground(spec),
    async intelOn() {
      await api.loadIntel();
      return api.isOn('transcription');
    },
  };
}

let deps: AutoDeps | null = null;
const getDeps = async (): Promise<AutoDeps> => (deps ??= await realDeps());

/** Recordings waiting for Work offline to end, because the engine sends audio away. */
const waiting = new Map<string, SavedRecording>();

let unwatch: (() => void) | null = null;

/** Puts the transcript on a page that isn't shown, by opening it just for the change. */
async function placeClosed(using: AutoDeps, saved: SavedRecording, data: TranscriptData): Promise<boolean> {
  const open = await using.pages().open(saved.page, { viewport: null });
  try {
    // A transcript made meanwhile, by hand or by another job, is kept.
    if (transcriptsOf(open.initial.view).some((held) => held.recording === data.recording)) return false;
    const block = {
      id: newId(),
      type: TRANSCRIPT_TYPE,
      data: { recording: data.recording },
      fallback: fallbackOf(data),
    } as unknown as NewBlock;
    const edits: Edit[] = [
      { edit: 'insertBlock', block, after: saved.block } as Edit,
      { edit: 'setPage', view: { transcripts: { [data.recording]: data } } } as Edit,
    ];
    await open.send({ edits });
    await open.saveNow();
    return true;
  } finally {
    await open.close();
  }
}

/** Transcribes one saved recording and places the transcript with its summary. */
async function transcribe(using: AutoDeps, saved: SavedRecording, signal: AbortSignal): Promise<void> {
  const engine = currentEngine();
  if (!engine) throw new Error(t('audioMore.transcript.engineNone'));
  const which = extrasOf(saved.entry).transcribeWith === 'enhanced' ? 'enhanced' : 'original';
  const result = await engine.transcribe({
    assetsDir: await using.assetsDir(saved.page),
    entry: playable(saved.entry, which),
    signal,
    interactive: false,
  });
  if (signal.aborted) return;
  const data = fromSegments(saved.entry.id, result.segments, 'engine', result.language);
  if (data.lines.length === 0) return;
  const summary = await using.summarize(data);
  const full = summary ? { ...data, summary } : data;
  const placed = (await using.placeShown(saved.page, saved.block, full)) || (await placeClosed(using, saved, full));
  if (!placed) return;
  const message = t('intelSpeech.auto.ready', { name: saved.label ?? t('intelSpeech.auto.recording') });
  announce(message);
  showToast({ message });
}

function queue(using: AutoDeps, saved: SavedRecording): Promise<boolean> {
  return using.enqueue({
    id: `transcript-${saved.entry.id}`,
    kind: 'transcription',
    label: t('intelSpeech.auto.label', { name: saved.label ?? t('intelSpeech.auto.recording') }),
    automatic: true,
    run: (signal) => transcribe(using, saved, signal),
  });
}

/**
 * A recording was saved: queues its transcript when the person asked for one with every recording. Returns whether a
 * job was queued, or is waiting for Work offline to end.
 */
export async function recordingSaved(saved: SavedRecording): Promise<boolean> {
  if (!isEnabled('intel.autoTranscripts') || !isEnabled('transcripts.block')) return false;
  try {
    await loadAutoTranscripts();
    if (!autoTranscripts.get()) return false;
    const using = await getDeps();
    if (!(await using.intelOn())) return false;
    const engine = currentEngine();
    if (!engine) return false;
    if (engine.cloud === true && using.isOffline()) {
      waiting.set(saved.entry.id, saved);
      unwatch ??= using.watchOnline(() => void onlineAgain());
      return true;
    }
    return await queue(using, saved);
  } catch {
    // The recording is saved either way, and "Make a transcript" still works by hand.
    return false;
  }
}

/** Work offline ended: the recordings that waited for it are queued. */
export async function onlineAgain(): Promise<void> {
  const using = await getDeps();
  if (using.isOffline()) return;
  const held = [...waiting.values()];
  waiting.clear();
  for (const saved of held) await queue(using, saved);
}

/** Tests use their own surroundings, and start over. */
export function setAutoDepsForTests(next: AutoDeps | null): void {
  deps = next;
  loaded = null;
  unwatch?.();
  unwatch = null;
  waiting.clear();
  autoTranscripts.set(false);
}
