// Whether live captions are on, where they sit, and what they show (A2-25). The choice is kept on this device with
// the other on-device choices, and the words live only in memory, for as long as the recording runs.
import { createStore } from '../../../state/store';
import { EMPTY } from './model';
import type { Captions } from './model';

export type Position = 'bottom' | 'top';

export interface CaptionChoices {
  on: boolean;
  position: Position;
}

const FILE = 'live-captions.json';
const DEFAULTS: CaptionChoices = { on: false, position: 'bottom' };

export const captionChoices = createStore<CaptionChoices>(DEFAULTS, 'live caption choices');
export const captionWords = createStore<Captions>(EMPTY, 'live caption words');
/** Whether the strip is open: a recording is running and captions are listening. */
export const captionsOpen = createStore<boolean>(false, 'live captions open');

const intelExt = async () => (await (await import('../../intel')).loadApi()).intelExt();
let loaded: Promise<void> | null = null;

/** Reads the saved choices once. */
export function loadCaptionChoices(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await (await intelExt()).get(FILE);
      const saved = text ? (JSON.parse(text) as Partial<CaptionChoices>) : null;
      captionChoices.set({
        on: saved?.on === true,
        position: saved?.position === 'top' ? 'top' : 'bottom',
      });
    } catch {
      // The defaults stay: captions off, at the bottom.
    }
  })();
  return loaded;
}

/** Changes a choice and keeps it on this device. */
export async function setCaptionChoices(patch: Partial<CaptionChoices>): Promise<void> {
  const next = { ...captionChoices.get(), ...patch };
  captionChoices.set(next);
  try {
    await (await intelExt()).put(FILE, JSON.stringify(next));
  } catch {
    // The choice lasts until the app closes.
  }
}
