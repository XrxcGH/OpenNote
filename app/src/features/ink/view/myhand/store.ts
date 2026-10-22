// The one place the handwriting style is read and written (flag ink.myHandwriting). The shell keeps it encrypted in
// this device's local folder (app/src-tauri/src/shellqol/handstyle.rs); the web build keeps it in memory. It never
// goes to the notes, the settings, the search index, a log, or a report: nothing here logs, and a failure is kept as
// a code the interface turns into a calm sentence, never with any of the style in it.
import { shellCall } from '../../../../platform/shellqol';
import { createStore } from '../../../../state/store';
import { buildStyle, isComplete, withSymbols } from '../../myhand/metrics';
import type { ConfirmedSymbol } from '../../myhand/metrics';
import { emptyDoc, parseDoc } from '../../myhand/style';
import type { KeptUpload, MathHabits, Progress, RawSample, StyleDoc } from '../../myhand/style';

export type StyleStatus = 'idle' | 'loading' | 'ready' | 'unreadable' | 'unavailable';

export interface StyleState {
  readonly status: StyleStatus;
  readonly doc: StyleDoc;
  /** Set while a save is on its way, so the interface can say so. */
  readonly saving: boolean;
  /** The last save failed: the writing is still here, and the next change tries again. */
  readonly saveFailed: boolean;
}

export const styleState = createStore<StyleState>(
  { status: 'idle', doc: emptyDoc(), saving: false, saveFailed: false },
  'my handwriting style',
);

let loading: Promise<void> | null = null;

/** Reads the stored style once; later calls wait for the same read. */
export function loadStyle(): Promise<void> {
  if (styleState.get().status !== 'idle' && loading) return loading;
  styleState.set((s) => ({ ...s, status: 'loading' }));
  loading = shellCall<{ state?: string; doc?: unknown } | null>('handstyle.load')
    .then((answer) => {
      if (answer?.state === 'ok') {
        const doc = parseDoc(answer.doc);
        styleState.set((s) => ({ ...s, status: doc ? 'ready' : 'unreadable', doc: doc ?? emptyDoc() }));
      } else if (answer?.state === 'unreadable') {
        styleState.set((s) => ({ ...s, status: 'unreadable', doc: emptyDoc() }));
      } else styleState.set((s) => ({ ...s, status: 'ready', doc: emptyDoc() }));
    })
    .catch(() => styleState.set((s) => ({ ...s, status: 'unavailable' })));
  return loading;
}

let pending: StyleDoc | null = null;
let writing: Promise<void> | null = null;

/** Saves the newest document; saves made while one is on its way are folded into the next. */
function persist(doc: StyleDoc): Promise<void> {
  pending = doc;
  styleState.set((s) => ({ ...s, doc, saving: true }));
  if (writing) return writing;
  writing = (async () => {
    while (pending) {
      const next = pending;
      pending = null;
      try {
        await shellCall('handstyle.save', { doc: next });
        styleState.set((s) => ({ ...s, saveFailed: false }));
      } catch {
        styleState.set((s) => ({ ...s, saveFailed: true }));
      }
    }
    styleState.set((s) => ({ ...s, saving: false }));
    writing = null;
  })();
  return writing;
}

const doc = () => styleState.get().doc;

/** Keeps one box's writing, or clears it when `sample` is null. */
export function setSample(id: string, sample: RawSample | null, step?: number): Promise<void> {
  const samples = { ...doc().progress.samples };
  if (sample && sample.strokes.length > 0) samples[id] = sample;
  else delete samples[id];
  const progress: Progress = { samples, step: step ?? doc().progress.step };
  return persist({ ...doc(), progress });
}

/** Remembers the step the person was on, so they come back to it. */
export function setStep(step: number): Promise<void> {
  if (doc().progress.step === step) return Promise.resolve();
  return persist({ ...doc(), progress: { ...doc().progress, step } });
}

/** Makes (or remakes) the style from a finished calibration page. False when the page isn't finished. */
export async function finishCalibration(now = Date.now()): Promise<boolean> {
  const current = doc();
  if (!isComplete(current.progress)) return false;
  const style = buildStyle(current.progress, current.style, now);
  if (!style) return false;
  await persist({ ...current, style });
  return true;
}

/** Makes the style again from the samples, after the Math and science section adds some. */
export async function rebuildStyle(now = Date.now()): Promise<void> {
  const current = doc();
  if (!current.style) return;
  const style = buildStyle(current.progress, current.style, now);
  if (style) await persist({ ...current, style });
}

/** Starts the calibration page again from the start. The old style stays until the new page is finished. */
export function recalibrate(): Promise<void> {
  const current = doc();
  const kept = Object.fromEntries(Object.entries(current.progress.samples).filter(([id]) => id.startsWith('math:')));
  return persist({ ...current, progress: { samples: kept, step: 0 } });
}

/** Adds confirmed symbols from an upload, and the habits measured from them. Uploads never make a style. */
export async function addSymbols(
  symbols: readonly ConfirmedSymbol[],
  habits: MathHabits | null,
  keep: readonly KeptUpload[],
): Promise<boolean> {
  const current = doc();
  if (!current.style) return false;
  const style = withSymbols(habits ? { ...current.style, math: habits } : current.style, symbols, Date.now());
  await persist({ ...current, style, kept: [...current.kept, ...keep].slice(-20) });
  return true;
}

export function removeKept(at: number): Promise<void> {
  return persist({ ...doc(), kept: doc().kept.filter((_, i) => i !== at) });
}

/** Deletes the style, the calibration page, kept uploads, and the key, for good. */
export async function deleteStyle(): Promise<boolean> {
  pending = null;
  try {
    await writing;
    await shellCall('handstyle.delete');
    styleState.set({ status: 'ready', doc: emptyDoc(), saving: false, saveFailed: false });
    return true;
  } catch {
    return false;
  }
}

/** Test builds: forget what was read, so a test starts from the store again. */
export function resetStyleForTests(): void {
  loading = null;
  pending = null;
  writing = null;
  styleState.set({ status: 'idle', doc: emptyDoc(), saving: false, saveFailed: false });
}

/** Test builds: puts a whole calibration page in, as if it had been written. */
export function setProgressForTests(progress: Progress): Promise<void> {
  return persist({ ...doc(), progress });
}
