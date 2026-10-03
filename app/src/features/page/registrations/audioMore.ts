// The audio lane's later registrations (quality of life after Phase 9): the Recording section of Settings, the
// commands for the storage list and for snapping the screen, the watch for audio files dropped on a page, and the
// meeting prompt's watch. This file loads at start-up, so it holds definitions only; the screens and the work load on
// first use.
import { isEnabled } from '../../../app/flags';
import type { FlagId } from '../../../app/flags';
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import { commands, settingsSections } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { installDropWatch } from '../audio/drop';
import { isRunning, recordingChoices, recordingUi } from '../audio/state';

settingsSections.register({
  id: 'recording',
  title: 'audioMore.settings.title',
  icon: 'Microphone',
  // After Editing, before On-device intelligence.
  order: 26,
  flag: 'settings.recording',
  load: () => import('../audio/SettingsSection'),
});

interface Spec {
  id: string;
  title: MessageKey;
  key?: string;
  flag: FlagId;
  when?: () => boolean;
  run(): Promise<void>;
}

const running = () => isRunning(recordingUi.get());
const snap = (kind: 'screen' | 'window' | 'region') => () =>
  import('../audio/snap').then((module) => module.snap(kind));

const SPECS: readonly Spec[] = [
  {
    id: 'audio.storage',
    title: 'audioMore.commands.storage',
    flag: 'audio.storage',
    run: () => import('../audio/openStorage').then((module) => module.openStorage()),
  },
  {
    id: 'audio.snapScreen',
    title: 'audioMore.commands.snapScreen',
    key: 'Alt+Shift+X',
    flag: 'audio.snap',
    when: running,
    run: snap('screen'),
  },
  {
    id: 'audio.snapWindow',
    title: 'audioMore.commands.snapWindow',
    key: 'Alt+Shift+W',
    flag: 'audio.snap',
    when: running,
    run: snap('window'),
  },
  {
    id: 'audio.snapRegion',
    title: 'audioMore.commands.snapRegion',
    key: 'Alt+Shift+Z',
    flag: 'audio.snap',
    when: running,
    run: snap('region'),
  },
];

for (const spec of SPECS) {
  const def: CommandDef = {
    id: spec.id as CommandDef['id'],
    title: spec.title,
    category: 'insert',
    keywords: 'audioMore.commands.keywords',
    ...(spec.key ? { keys: [chord(spec.key)], allowInTextInput: true } : {}),
    flag: spec.flag,
    ...(spec.when ? { when: spec.when } : {}),
    run: spec.run,
  };
  commands.register(defineCommand(def));
}

// Audio and video files dropped on a page become recordings.
installDropWatch();

// The meeting prompt's watch starts only when the person has turned it on, so a PC that never does loads nothing.
let watching = false;
function syncMeetingWatch(): void {
  const wanted = isEnabled('audio.meetingPrompt') && recordingChoices.get().meetingPrompt;
  if (!wanted && !watching) return;
  void import('../audio/meeting').then((module) => {
    watching = wanted;
    if (wanted) module.startWatching();
    else module.stopWatching();
  });
}
recordingChoices.subscribe(syncMeetingWatch);
if (typeof window !== 'undefined' && !import.meta.env.VITEST) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(syncMeetingWatch, { timeout: 5000 });
  else setTimeout(syncMeetingWatch, 2000);
}
