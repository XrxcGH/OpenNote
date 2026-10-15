// Live captions follow the recording (A2-25): they start when a recording runs and stop when it pauses or ends.
import { recordingUi } from '../audio/state';

let installed = false;

/** Watches the recording and opens or closes the captions with it. Safe to call twice. */
export async function installLiveCaptions(): Promise<void> {
  if (installed) return;
  installed = true;
  const captions = await import('../../dictation');
  await captions.loadCaptionChoices();
  captions.mountCaptionStrip();
  let last = recordingUi.get().phase;
  const follow = () => {
    const phase = recordingUi.get().phase;
    if (phase === last) return;
    last = phase;
    if (phase === 'recording') void captions.startCaptions();
    else void captions.stopCaptions();
  };
  recordingUi.subscribe(follow);
  follow();
}
