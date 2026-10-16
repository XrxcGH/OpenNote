// The meeting prompt (Phase 9). Off until the person turns it on in Settings. While it is on, the host is asked every
// few seconds which app, if any, has just started using the microphone. It sees the app's name and nothing else. The
// answer is a small prompt with three choices, shown once for each call, and a recording never starts on its own:
// only "Record this meeting" starts one.
import { isEnabled } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, Dialog } from '../../../ui';
import { openDialog } from './dialog';
import { moreClient } from './moreClient';
import { isRunning, recordingChoices, recordingUi } from './state';

const NEVER_KEY = 'opennote.audio.meetingNever';
export const POLL_MS = 5000;

/** The apps the person chose "Never for this app" for, in lowercase. */
export function neverApps(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(NEVER_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function neverFor(app: string): void {
  try {
    localStorage.setItem(NEVER_KEY, JSON.stringify([...new Set([...neverApps(), app.toLowerCase()])]));
  } catch {
    // Without storage the choice lasts until the next call.
  }
}

type Choice = 'record' | 'later' | 'never';

function ask(app: string): Promise<Choice> {
  let choice: Choice = 'later';
  return openDialog((close) => {
    const pick = (next: Choice) => () => {
      choice = next;
      close();
    };
    return (
      <Dialog
        title={t('audioMore.meeting.title')}
        description={t('audioMore.meeting.body', { app })}
        onDismiss={close}
        initialFocus="leastDestructive"
        actions={[
          { id: 'never', label: t('audioMore.meeting.never'), variant: 'quiet', onPress: pick('never') },
          {
            id: 'later',
            label: t('audioMore.meeting.notNow'),
            variant: 'secondary',
            onPress: pick('later'),
            leastDestructive: true,
          },
          { id: 'record', label: t('audioMore.meeting.record'), variant: 'primary', onPress: pick('record') },
        ]}
      >
        <p>{t('audio.options.consent')}</p>
      </Dialog>
    );
  }).then(() => choice);
}

let timer: ReturnType<typeof setInterval> | null = null;
let asking = false;

const wanted = (): boolean => isEnabled('audio.meetingPrompt') && recordingChoices.get().meetingPrompt;

async function tick(): Promise<void> {
  if (asking) return;
  if (!wanted()) return stopWatching();
  try {
    const offer = await (await moreClient()).meetingPoll(true, neverApps(), isRunning(recordingUi.get()));
    if (!offer) return;
    asking = true;
    const choice = await ask(offer.app);
    if (choice === 'never') {
      neverFor(offer.app);
      announce(t('audioMore.meeting.neverDone', { app: offer.app }));
    } else if (choice === 'record') {
      await executeCommand('audio.record', undefined, 'commandBar');
    }
  } catch {
    // Watching is quiet: a failed look is tried again at the next one.
  } finally {
    asking = false;
  }
}

/** Starts looking, if the person turned it on. */
export function startWatching(): void {
  if (timer || !wanted()) return;
  timer = setInterval(() => void tick(), POLL_MS);
  void tick();
}

export function stopWatching(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
