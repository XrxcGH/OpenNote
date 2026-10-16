// Opening a live speech session for dictation or live captions (A2-24, A2-25). It asks to turn transcription on if it
// is off, finds the downloaded speech model, adds the notebook's vocabulary, and starts the session in the shell.
// The shell opens the microphone only after this runs, which only a press on Dictate or a recording's captions
// switch causes. Words come back through `onUpdate`; audio never does.
import { getLocation } from '../../../app/location';
import { streamHost } from '../../../platform/intelStream';
import type { StreamPurpose, StreamUpdate } from '../../../platform/intelStream';
import { askToTurnOn } from '../runtime';
import { modelToUse } from '../transcribe/engine';
import { loadVocabulary } from '../vocabulary/store';

export interface Listening {
  /** Closes the microphone and ends the session. Safe to call twice. */
  stop(): Promise<void>;
}

export interface ListenOptions {
  purpose: StreamPurpose;
  onUpdate(update: StreamUpdate): void;
  /** False when nothing may be asked, as for captions that were turned on earlier. */
  ask?: boolean;
  language?: string | null;
}

const notebookNow = (): string | null => {
  const where = getLocation();
  return where.view === 'workspace' ? where.notebookId : null;
};

/** Starts a session. Resolves null when the person said not now, when no speech model is downloaded, or on failure. */
export async function listen(options: ListenOptions): Promise<Listening | null> {
  const { isOn } = await import('../choices');
  if (options.ask === false ? !isOn('transcription') : !(await askToTurnOn('transcription'))) return null;
  const model = await modelToUse();
  if (!model) return null;
  const vocabulary = await loadVocabulary(notebookNow()).catch(() => '');
  const host = streamHost();
  let session: string | null = null;
  let stopped = false;
  const early: [string, StreamUpdate][] = [];
  const deliver = (id: string, update: StreamUpdate) => {
    if (id !== session) return;
    if (update.kind === 'ended') {
      stopped = true;
      unlisten();
    }
    options.onUpdate(update);
  };
  const unlisten = host.listen((id, update) => {
    if (session === null) early.push([id, update]);
    else deliver(id, update);
  });
  try {
    session = await host.start({ purpose: options.purpose, model, language: options.language ?? null, vocabulary });
  } catch (error) {
    unlisten();
    options.onUpdate({ kind: 'ended', error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  early.splice(0).forEach(([id, update]) => deliver(id, update));
  const started = session;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      await host.stop(started).catch(() => false);
      unlisten();
    },
  };
}
