// The audio lane's later registrations (quality of life after Phase 9): the Recording section of Settings, the
// commands for the storage list and for snapping the screen, the watch for audio files dropped on a page, and the
// meeting prompt's watch. This file loads at start-up, so it holds definitions only; the screens and the work load on
// first use.
import { isEnabled } from '../../../app/flags';
import type { FlagId } from '../../../app/flags';
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import { commands, settingsSections } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { shownPage as shownOpenPage } from '../history/shown';
import { installDropWatch } from '../audio/drop';
import { installMomentLinks } from '../audio/momentLinks';
import { isRunning, recordingChoices, recordingUi } from '../audio/state';
import { TRANSCRIPT_TYPE } from '../audio/transcripts/moment';
import { blockRenderers } from '../registries';
import { shownQueue } from '../sync/shown';
import { lazyBlockView } from '../tables/lazyView';

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
const pageShown = () => shownQueue.get() !== null;
const transcripts = () => import('../audio/transcripts/commands');
const edits = () => import('../audio/commands');
const snap = (kind: 'screen' | 'window' | 'region') => () =>
  import('../audio/snap').then((module) => module.snap(kind));

const SPECS: readonly Spec[] = [
  {
    id: 'audio.split',
    title: 'audioMore.commands.split',
    flag: 'audio.trim',
    when: pageShown,
    run: () => edits().then((module) => module.split()),
  },
  {
    id: 'audio.enhance',
    title: 'audioMore.commands.enhance',
    flag: 'audio.enhance',
    when: pageShown,
    run: () => edits().then((module) => module.enhance()),
  },
  {
    id: 'audio.exportWav',
    title: 'audioMore.commands.exportWav',
    flag: 'audio.export',
    when: pageShown,
    run: () => edits().then((module) => module.exportAs('wav')),
  },
  {
    id: 'audio.exportOpus',
    title: 'audioMore.commands.exportOpus',
    flag: 'audio.export',
    when: pageShown,
    run: () => edits().then((module) => module.exportAs('opus')),
  },
  {
    id: 'audio.removePart',
    title: 'audio.block.removePart',
    flag: 'audio.trim',
    when: pageShown,
    run: () => edits().then((module) => module.removeSelected()),
  },
  {
    id: 'audio.storage',
    title: 'audioMore.commands.storage',
    flag: 'audio.storage',
    run: () => import('../audio/openStorage').then((module) => module.openStorage()),
  },
  {
    id: 'transcripts.make',
    title: 'audioMore.transcript.commands.make',
    flag: 'transcripts.block',
    when: pageShown,
    run: async () => (await transcripts()).make(),
  },
  {
    id: 'transcripts.add',
    title: 'audioMore.transcript.commands.add',
    flag: 'transcripts.block',
    when: pageShown,
    run: async () => (await transcripts()).add(),
  },
  {
    id: 'transcripts.recap',
    title: 'audioMore.transcript.commands.recap',
    flag: 'transcripts.recap',
    when: pageShown,
    run: async () => (await transcripts()).recap(),
  },
  {
    id: 'transcripts.quote',
    title: 'audioMore.transcript.commands.quote',
    key: 'Alt+Shift+O',
    flag: 'transcripts.notes',
    when: pageShown,
    run: async () => (await transcripts()).quote(),
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
    keywords: spec.id.startsWith('transcripts.')
      ? 'audioMore.transcript.commands.keywords'
      : 'audioMore.commands.keywords',
    ...(spec.key ? { keys: [chord(spec.key)], allowInTextInput: true } : {}),
    flag: spec.flag,
    ...(spec.when ? { when: spec.when } : {}),
    run: spec.run,
  };
  commands.register(defineCommand(def));
}

// Audio and video files dropped on a page become recordings, and a link to a moment plays it.
installDropWatch();
installMomentLinks();

// A recording's transcript is a block of its own, after the recording.
blockRenderers.register({
  id: 'transcript',
  types: [TRANSCRIPT_TYPE],
  priority: 1,
  flag: 'transcripts.block',
  create: (block, ctx) =>
    lazyBlockView(block, ctx, () => import('../audio/transcripts/blockRenderer'), t('audioMore.transcript.heading')),
});

// A page with recordings or transcripts gets its transcripts, so a command can find them before a block draws.
shownOpenPage.subscribe(() => {
  const page = shownOpenPage.get();
  const view = page?.initial.view as { recordings?: unknown; transcripts?: unknown } | null | undefined;
  if (page && (view?.transcripts || view?.recordings)) {
    void import('../audio/transcripts/store').then((module) => module.adoptTranscripts(page));
  }
});

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
