// Phase 9's registrations for audio recording: the commands and their keys, the record control in the command bar,
// the indicator in the title bar, the recording block's renderer, and the recovery of a recording that a crash cut
// off. This file loads at start-up, so it holds definitions only; each command's work, the block, and the recovery
// load on first use (features/page/audio).
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import type { FlagId } from '../../../app/flags';
import { commandBar, commands, titleBarItems } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { RecordControl } from '../audio/RecordControl';
import { RecordingIndicator } from '../audio/Indicator';
import { adoptPage, entriesOf } from '../audio/entries';
import { isRunning, playbackOpen, RECORDING_TYPE, recordingUi } from '../audio/state';
import { shownPage as shownOpenPage } from '../history/shown';
import { blockRenderers } from '../registries';
import { shownQueue } from '../sync/shown';
import { lazyBlockView } from '../tables/lazyView';

const work = () => import('../audio/commands');
const pageShown = () => shownQueue.get() !== null;
const running = () => isRunning(recordingUi.get());

interface Spec {
  id: string;
  title: MessageKey;
  key: string;
  flag: FlagId;
  when?: () => boolean;
  run(): Promise<void>;
}

const SPECS: readonly Spec[] = [
  {
    id: 'audio.record',
    title: 'audio.commands.record',
    key: 'Alt+Shift+A',
    flag: 'audio.record',
    // Always available, because the command bar reads it when it draws, before a page is shown; with no page open,
    // the command says so.
    run: async () => {
      const commands = await work();
      await (running() ? commands.stop() : commands.record());
    },
  },
  {
    id: 'audio.stop',
    title: 'audio.commands.stop',
    key: 'Alt+Shift+S',
    flag: 'audio.record',
    when: running,
    run: async () => (await work()).stop(),
  },
  {
    id: 'audio.pause',
    title: 'audio.commands.pause',
    key: 'Alt+Shift+P',
    flag: 'audio.record',
    when: running,
    run: async () => (await work()).pause(),
  },
  {
    id: 'audio.play',
    title: 'audio.commands.play',
    key: 'Alt+Shift+K',
    flag: 'audio.record',
    when: pageShown,
    run: async () => (await work()).play(),
  },
  {
    id: 'audio.skipBack',
    title: 'audio.commands.skipBack',
    key: 'Alt+Shift+J',
    flag: 'audio.record',
    when: pageShown,
    run: async () => (await work()).skip('back'),
  },
  {
    id: 'audio.skipForward',
    title: 'audio.commands.skipForward',
    key: 'Alt+Shift+L',
    flag: 'audio.record',
    when: pageShown,
    run: async () => (await work()).skip('forward'),
  },
  {
    id: 'audio.flag',
    title: 'audio.commands.flag',
    key: 'Alt+Shift+M',
    flag: 'audio.flags',
    when: pageShown,
    run: async () => (await work()).flag(),
  },
  {
    id: 'audio.nextFlag',
    title: 'audio.commands.nextFlag',
    key: 'Alt+Shift+N',
    flag: 'audio.flags',
    when: pageShown,
    run: async () => (await work()).goToFlag('next'),
  },
  {
    id: 'audio.previousFlag',
    title: 'audio.commands.previousFlag',
    key: 'Alt+Shift+B',
    flag: 'audio.flags',
    when: pageShown,
    run: async () => (await work()).goToFlag('previous'),
  },
  {
    id: 'audio.playFromCaret',
    title: 'audio.commands.playFromCaret',
    key: 'Alt+Shift+C',
    flag: 'audio.stamps',
    when: pageShown,
    run: async () => (await work()).playFromCaret(),
  },
  {
    id: 'audio.trimSilence',
    title: 'audio.commands.trimSilence',
    key: '',
    flag: 'audio.trim',
    when: pageShown,
    run: async () => (await work()).trim(),
  },
];

for (const spec of SPECS) {
  const def: CommandDef = {
    id: spec.id as CommandDef['id'],
    title: spec.title,
    category: 'insert',
    keywords: 'audio.commands.keywords',
    ...(spec.key ? { keys: [chord(spec.key)], allowInTextInput: true } : {}),
    flag: spec.flag,
    ...(spec.when ? { when: spec.when } : {}),
    run: spec.run,
  };
  commands.register(defineCommand(def));
}

commandBar.register({
  id: 'audio.record',
  tab: 'home',
  group: 'recording',
  command: 'audio.record',
  // High, so the record control is the last to move into More when the bar is full: it must be reachable mid-note.
  priority: 99,
  presentation: 'component',
  Component: RecordControl,
  flag: 'audio.record',
});

titleBarItems.register({
  id: 'audio.indicator',
  side: 'end',
  order: 80,
  priority: 98,
  compact: 'appBar',
  Component: RecordingIndicator,
});

blockRenderers.register({
  id: 'recording',
  types: [RECORDING_TYPE],
  priority: 1,
  flag: 'audio.record',
  create: (block, ctx) =>
    lazyBlockView(block, ctx, () => import('../audio/blockRenderer'), t('audio.block.labelWhile')),
});

// A page that opens with a recording the crash cut off gets it back. A recording that plays closes when another
// page opens, so its device is free.
shownOpenPage.subscribe(() => {
  const page = shownOpenPage.get();
  if (playbackOpen.get()) void import('../audio/playback').then((module) => module.closePlayback());
  if (!page) return;
  adoptPage(page);
  const entries = entriesOf(page.initial.view);
  if (entries.some((entry) => entry.state === 'recording')) {
    void import('../audio/recover').then((module) => module.recoverPage(page));
  }
  // Text typed on a page with a recording is stamped, and Alt+click on it plays the recording.
  if (entries.length > 0) void import('../audio/watch').then((module) => module.activate());
});
