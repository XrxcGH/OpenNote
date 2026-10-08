// The read-aloud engine the page asks for (Phase 12). It is a thin stand-in that loads the real engine, and with it the
// intel client, when reading first starts, so the page's small read-aloud chunk does not carry them. The page asks
// for it when reading starts. It answers only while the person has read aloud turned on, and otherwise the page
// keeps using the voices of the browser.
import { isEnabled } from '../../app/flags';
import { isOn } from './choices';
import type { OnDeviceSpeech } from './speechEngine';

let real: OnDeviceSpeech | null = null;
let loading: Promise<OnDeviceSpeech> | null = null;
/** Counts starts and cancels, so a start that was waiting for the engine to load is dropped when canceled. */
let run = 0;

function engine(): Promise<OnDeviceSpeech> {
  loading ??= import('./speechEngine').then((module) => (real = module.createOnDeviceSpeech()));
  return loading;
}

const proxy: OnDeviceSpeech = {
  voices: () => engine().then((one) => one.voices()),
  speak(text, options, onBoundary, onEnd) {
    const mine = ++run;
    void engine().then((one) => {
      if (run === mine) one.speak(text, options, onBoundary, onEnd);
    });
  },
  pause: () => real?.pause(),
  resume: () => real?.resume(),
  cancel() {
    run += 1;
    real?.cancel();
  },
};

/** The on-device engine while the person has read aloud turned on here, else null. Read when reading starts. */
export function intelSpeechEngine(): OnDeviceSpeech | null {
  return isEnabled('intel.readAloud') && isOn('readAloud') ? proxy : null;
}
