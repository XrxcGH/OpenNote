// Live captions for a running recording (A2-25): when the recording starts and captions are on, listen to the
// microphone, show the words on the strip, and stop when the recording stops or pauses. The captions are not kept:
// the recording's transcript, made as usual, is what stays.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { loadApi } from '../../intel';
/** A running session that can be stopped. */
interface Listening {
  stop(): Promise<void>;
}
import { EMPTY, reduceCaptions } from './model';
import { captionChoices, captionWords, captionsOpen } from './store';

let current: Listening | null = null;
let starting = false;

/** Starts the captions for a recording that began. Does nothing when captions are off or already running. */
export async function startCaptions(): Promise<void> {
  if (!captionChoices.get().on || current || starting) return;
  starting = true;
  captionWords.set(EMPTY);
  captionsOpen.set(true);
  try {
    // Turned on before, in Settings: nothing is asked now, and a missing model or switch just leaves them off.
    const session = await (
      await loadApi()
    ).listen({
      purpose: 'captions',
      ask: false,
      onUpdate: (update) => {
        if (update.kind === 'ended') {
          current = null;
          captionsOpen.set(false);
          if (update.error) showToast({ message: t('intelMore.captions.failed', { message: update.error }) });
          return;
        }
        captionWords.set((state) => reduceCaptions(state, update));
      },
    });
    if (session) {
      current = session;
      announce(t('intelMore.captions.started'));
    } else {
      captionsOpen.set(false);
    }
  } finally {
    starting = false;
  }
}

/** Closes the captions and the microphone they used. */
export async function stopCaptions(): Promise<void> {
  const session = current;
  current = null;
  captionsOpen.set(false);
  captionWords.set(EMPTY);
  await session?.stop();
}
