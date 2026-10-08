// The on-device transcript engine (Phase 12, A1-3): the page's "Make transcript" asks it for a recording's lines,
// and it runs the downloaded Whisper model in the shell, in the background, one job at a time. It turns
// transcription on only after asking, uses the notebook's custom vocabulary, and reports progress as it goes. When no
// speech model is on this device it says so and offers the download, which asks before it starts.
import { getLocation } from '../../../app/location';
import type { RecordingEntry } from '../../../core/audio';
import { speechHost } from '../../../platform/intelSpeech';
import type { SpeechJobUpdate, SpeechLine } from '../../../platform/intelSpeech';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { refreshModels, selectedSpeechModel } from '../models/store';
import { askToTurnOn } from '../runtime';
import { loadVocabulary } from '../vocabulary/store';
import { pickSpeechModel } from './model';

export interface OnDeviceTranscribeRequest {
  assetsDir: string;
  entry: RecordingEntry;
  onProgress?(fraction: number): void;
  /** Stops the job. The promise then rejects with a TranscribeCanceled. */
  signal?: AbortSignal;
  /** The spoken language as a BCP 47 tag, or null to detect it. */
  language?: string | null;
}

export interface OnDeviceTranscribeResult {
  language: string | null;
  segments: SpeechLine[];
}

/** Why a job ended without a transcript, with a sentence for the person. */
export class TranscribeStopped extends Error {
  constructor(
    readonly reason: 'off' | 'noModel' | 'canceled' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

const notebookNow = (): string | null => {
  const where = getLocation();
  return where.view === 'workspace' ? where.notebookId : null;
};

/** The model to use, or null after telling the person how to get one. */
async function modelToUse(): Promise<string | null> {
  const model = pickSpeechModel(await refreshModels(), await selectedSpeechModel());
  if (model) return model;
  showToast({
    message: t('intelSpeech.transcribe.noModel'),
    action: {
      label: t('intelSpeech.transcribe.getModel'),
      run: () => void import('../../../app/location').then((m) => m.navigate({ view: 'settings', section: 'intel' })),
    },
  });
  return null;
}

/** Runs one job and resolves with its lines. */
function runJob(
  request: OnDeviceTranscribeRequest,
  model: string,
  vocabulary: string,
): Promise<OnDeviceTranscribeResult> {
  const host = speechHost();
  return new Promise((resolve, reject) => {
    let job: string | null = null;
    const early: [string, SpeechJobUpdate][] = [];
    const onUpdate = (id: string, update: SpeechJobUpdate) => {
      if (job === null) return void early.push([id, update]);
      if (id !== job) return;
      if (update.kind === 'progress') request.onProgress?.(update.fraction);
      else if (update.kind === 'done') {
        stop();
        resolve({ language: update.language, segments: update.lines });
      } else if (update.kind === 'failed') {
        stop();
        reject(new TranscribeStopped('failed', update.error.message));
      } else if (update.kind === 'canceled') {
        stop();
        reject(new TranscribeStopped('canceled', t('intelSpeech.transcribe.canceled')));
      }
    };
    const unlisten = host.listen(onUpdate);
    const abort = () => {
      if (job) void host.cancel(job);
    };
    const stop = () => {
      unlisten();
      request.signal?.removeEventListener('abort', abort);
    };
    request.signal?.addEventListener('abort', abort);
    host
      .start({
        assetsDir: request.assetsDir,
        entry: request.entry,
        model,
        choices: { language: request.language ?? null, vocabulary },
      })
      .then(
        (id) => {
          job = id;
          if (request.signal?.aborted) abort();
          early.splice(0).forEach(([one, update]) => onUpdate(one, update));
        },
        (error: unknown) => {
          stop();
          const message = (error as { message?: string } | null)?.message ?? t('intelSpeech.transcribe.failed');
          reject(new TranscribeStopped('failed', message));
        },
      );
  });
}

/**
 * Transcribes a recording on this device. Asks to turn transcription on when it is off, and rejects with a
 * TranscribeStopped when the person says not now, when no model is downloaded, or when the job fails or is canceled.
 */
export async function transcribeOnDevice(
  request: OnDeviceTranscribeRequest,
  options: { ask?: boolean } = {},
): Promise<OnDeviceTranscribeResult> {
  const { isOn } = await import('../choices');
  if (options.ask === false ? !isOn('transcription') : !(await askToTurnOn('transcription'))) {
    throw new TranscribeStopped('off', t('intelSpeech.transcribe.off'));
  }
  const model =
    options.ask === false ? pickSpeechModel(await refreshModels(), await selectedSpeechModel()) : await modelToUse();
  if (!model) throw new TranscribeStopped('noModel', t('intelSpeech.transcribe.noModel'));
  const vocabulary = await loadVocabulary(notebookNow());
  return runJob(request, model, vocabulary);
}

/** The engine in the shape the page's transcript seam takes. */
export const onDeviceTranscriptEngine = {
  id: 'whisper',
  transcribe: (request: OnDeviceTranscribeRequest) => transcribeOnDevice(request),
};
