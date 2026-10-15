// Dictation's public face. The indicator mounts its own root while the microphone is open, so nothing here costs
// anything at start-up.
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { Indicator } from './Indicator';
import { dictationState, isDictating, startDictation, stopDictation } from './session';
import type { DictationEvents, DictationSink } from './session';

export type { DictationEvents, DictationSink };
export { dictationState, isDictating, stopDictation };
export { applySpeech } from './session';
export { parseSpeech } from './parse';

let mounted: { unmount(): void; host: HTMLElement } | null = null;

function mountIndicator(): void {
  if (mounted) return;
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  root.render(createElement(Indicator));
  mounted = { unmount: () => root.unmount(), host };
}

function unmountIndicator(): void {
  const gone = mounted;
  mounted = null;
  queueMicrotask(() => {
    gone?.unmount();
    gone?.host.remove();
  });
}

/** Starts dictating into the sink, with the indicator showing. Resolves false when it did not start. */
export async function dictate(target: DictationSink, handlers: DictationEvents = {}): Promise<boolean> {
  mountIndicator();
  const started = await startDictation(target, {
    ...handlers,
    onStopped: () => {
      unmountIndicator();
      handlers.onStopped?.();
    },
  });
  if (!started) unmountIndicator();
  return started;
}

/** Starts when idle and stops when listening. */
export async function toggleDictation(target: DictationSink, handlers: DictationEvents = {}): Promise<void> {
  if (isDictating()) await stopDictation();
  else await dictate(target, handlers);
}

export { CaptionsSwitch, loadCaptionChoices, mountCaptionStrip, startCaptions, stopCaptions } from './captions';
