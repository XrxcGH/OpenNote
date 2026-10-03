// The reader (ARCHITECTURE.md sections 19.2 and 19.3): speaks a sequence one utterance at a time, highlights the
// spoken word with the read-aloud CSS Custom Highlight, and keeps the word in view. Next and previous paragraph
// cancel the utterance and start another. If the person edits the paragraph being read, reading stops at its end.
import { rangeOver, textblockText } from '../../../editor/extensions/spellingText';
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';
import type { SpeakOptions, SpeechEngine } from './engine';
import type { ReadItem } from './sequence';

export const READ_HIGHLIGHT = 'read-aloud';

export type ReaderStatus = 'idle' | 'playing' | 'paused';

export interface ReaderState {
  status: ReaderStatus;
  index: number;
  total: number;
  /** True after a try to read found no local voice. */
  noVoice: boolean;
}

export interface Reader {
  readonly state: Store<ReaderState>;
  start(items: readonly ReadItem[]): void;
  /** Pauses while playing, resumes while paused; does nothing while idle. */
  toggle(): void;
  next(): void;
  previous(): void;
  stop(): void;
  /** The word spoken last, for tests. */
  word(): string | null;
}

export interface ReaderOptions {
  speakOptions(): SpeakOptions;
  reducedMotion(): boolean;
  /** The page's scrolling element. */
  scroller(): Element | null;
}

const IDLE: ReaderState = { status: 'idle', index: 0, total: 0, noVoice: false };
let stores = 0;

function setHighlight(range: Range | null): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  if (range) CSS.highlights.set(READ_HIGHLIGHT, new Highlight(range));
  else CSS.highlights.delete(READ_HIGHLIGHT);
}

function keepInView(range: Range, scroller: Element | null, reducedMotion: boolean): void {
  const box = range.getBoundingClientRect();
  const view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  range.startContainer.parentElement?.scrollIntoView({
    block: 'center',
    behavior: reducedMotion ? 'instant' : 'smooth',
  });
}

export function createReader(engine: SpeechEngine, options: ReaderOptions): Reader {
  const state = createStore<ReaderState>(IDLE, `read aloud ${(stores += 1)}`);
  let items: readonly ReadItem[] = [];
  let spoken: string | null = null;
  let textAtStart = '';

  const textNow = (item: ReadItem) => (item.source ? textblockText(item.element, false).text : '');

  const finish = () => {
    setHighlight(null);
    state.set((current) => ({ ...current, status: 'idle' }));
  };

  const speak = (index: number) => {
    const item = items[index];
    if (!item) return finish();
    state.set((current) => ({ ...current, status: 'playing', index, total: items.length }));
    textAtStart = textNow(item);
    setHighlight(null);
    if (!item.source) item.element.scrollIntoView?.({ block: 'nearest' });
    engine.speak(item.text, options.speakOptions(), (start, length) => onBoundary(item, start, length), onEnd);
  };

  const onBoundary = (item: ReadItem, start: number, length: number) => {
    spoken = item.text.slice(start, start + length);
    if (!item.source) return;
    const range = rangeOver(item.source, item.offset + start, length);
    setHighlight(range);
    if (range) keepInView(range, options.scroller(), options.reducedMotion());
  };

  const onEnd = (completed: boolean) => {
    const { index } = state.get();
    const item = items[index];
    if (!completed) {
      state.set((current) => ({ ...current, noVoice: true }));
      return finish();
    }
    state.set((current) => ({ ...current, noVoice: false }));
    if (!item || (item.source && textNow(item) !== textAtStart)) return finish();
    speak(index + 1);
  };

  const jump = (delta: number) => {
    const { status, index } = state.get();
    if (status === 'idle') return;
    engine.cancel();
    speak(Math.min(Math.max(index + delta, 0), items.length - 1));
  };

  return {
    state,
    start(next) {
      engine.cancel();
      items = next;
      if (!items.length) return finish();
      speak(0);
    },
    toggle() {
      const { status } = state.get();
      if (status === 'playing') {
        engine.pause();
        state.set((current) => ({ ...current, status: 'paused' }));
      } else if (status === 'paused') {
        engine.resume();
        state.set((current) => ({ ...current, status: 'playing' }));
      }
    },
    next: () => jump(1),
    previous: () => jump(-1),
    stop() {
      engine.cancel();
      items = [];
      finish();
    },
    word: () => spoken,
  };
}
