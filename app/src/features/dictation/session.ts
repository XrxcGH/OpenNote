// Dictation (A2-24): press Dictate, talk, and the words are typed at the cursor. This file is the session: it starts
// listening through the shell, turns each finished phrase into text and commands (parse.ts), and hands them to a
// sink that knows the editor. The sound is read on this device and never kept; only the words reach this side.
import type { StreamUpdate } from '../../platform/intelStream';
import { createStore } from '../../state/store';
import { loadApi } from '../intel';
/** A running session that can be stopped. */
interface Listening {
  stop(): Promise<void>;
}
import { capitalizeFor, parseSpeech } from './parse';

/** Where dictated words go. The page provides one for the editor that has the cursor. */
export interface DictationSink {
  /** The text before the cursor on its line, which decides whether the next word starts a sentence. */
  before(): string;
  insert(text: string): void;
  newline(): void;
  paragraph(): void;
  /** Takes back the last thing inserted. False when it is not there to take back. */
  undoLast(): boolean;
}

export interface DictationState {
  phase: 'idle' | 'starting' | 'listening' | 'speaking';
  /** A rough reading of the phrase being said. Shown, not typed. */
  partial: string;
  /** How far the words trail the speech, in milliseconds. */
  behindMs: number;
}

const IDLE: DictationState = { phase: 'idle', partial: '', behindMs: 0 };
export const dictationState = createStore<DictationState>(IDLE, 'dictation');

export interface DictationEvents {
  /** The session ended for a reason the person should read, such as the microphone being unavailable. */
  onProblem?(message: string): void;
  onStopped?(): void;
}

let sink: DictationSink | null = null;
let current: Listening | null = null;
let events: DictationEvents = {};

export const isDictating = (): boolean => dictationState.get().phase !== 'idle';

/** Applies what one finished phrase said. Exported for tests. */
export function applySpeech(target: DictationSink, spoken: string, stop: () => void): void {
  for (const step of parseSpeech(spoken)) {
    switch (step.kind) {
      case 'text':
        target.insert(capitalizeFor(target.before(), step.text));
        break;
      case 'newline':
        target.newline();
        break;
      case 'paragraph':
        target.paragraph();
        break;
      case 'undo':
        target.undoLast();
        break;
      case 'stop':
        stop();
        break;
    }
  }
}

function onUpdate(update: StreamUpdate): void {
  switch (update.kind) {
    case 'listening':
      dictationState.set({ ...IDLE, phase: 'listening' });
      break;
    case 'speaking':
      dictationState.set((state) => ({ ...state, phase: 'speaking' }));
      break;
    case 'partial':
      dictationState.set((state) => ({ ...state, partial: update.text, behindMs: update.behindMs }));
      break;
    case 'final':
      dictationState.set({ phase: 'listening', partial: '', behindMs: update.behindMs });
      if (sink) applySpeech(sink, update.text, () => void stopDictation());
      break;
    case 'ended': {
      const was = isDictating();
      current = null;
      sink = null;
      dictationState.set(IDLE);
      if (update.error) events.onProblem?.(update.error);
      if (was) events.onStopped?.();
      break;
    }
  }
}

/** Starts dictating into `target`. Resolves false when it did not start. */
export async function startDictation(target: DictationSink, handlers: DictationEvents = {}): Promise<boolean> {
  if (isDictating()) return false;
  dictationState.set({ ...IDLE, phase: 'starting' });
  sink = target;
  events = handlers;
  const started = await (await loadApi()).listen({ purpose: 'dictation', onUpdate });
  if (!started) {
    sink = null;
    // A session that failed to open has already said why through onUpdate; one the person declined says nothing.
    if (dictationState.get().phase === 'starting') dictationState.set(IDLE);
    return false;
  }
  current = started;
  return true;
}

/** Stops dictating and closes the microphone. */
export async function stopDictation(): Promise<void> {
  const session = current;
  current = null;
  dictationState.set(IDLE);
  sink = null;
  await session?.stop();
  events.onStopped?.();
}
