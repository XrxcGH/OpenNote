// Phase 12's commands: copy the text from an image, summarize a page, and turn handwriting into text. They register
// once start-up is done (registrations/intel.ts), so they cost nothing at start-up. The work loads on first use
// (one module for each). The person's choices load here too, because read aloud picks its engine when reading starts.
import { isEnabled } from '../../../app/flags';
import { chord, defineCommand } from '../../../commands/registry';
import { commandBar, commands } from '../../../registries';
import { oneImageSelected } from '../images/shown';
import { pageSelection } from '../seams/selectionStore';
import { shownQueue } from '../sync/shown';

commands.register(
  defineCommand({
    id: 'intel.copyImageText',
    title: 'intel.commands.copyImageText',
    keywords: 'intel.commands.copyImageTextKeywords',
    category: 'object',
    flag: 'intel.ocr',
    when: oneImageSelected,
    run: () => import('./copyImageText').then((module) => module.copyImageText()),
  }),
);

commands.register(
  defineCommand({
    id: 'intel.summarizePage',
    title: 'intel.commands.summarizePage',
    keywords: 'intel.commands.summarizePageKeywords',
    category: 'view',
    flag: 'intel.summaries',
    when: () => shownQueue.get() !== null,
    run: () => import('./summarize').then((module) => module.summarizePage()),
  }),
);

commands.register(
  defineCommand({
    id: 'intel.handwritingToText',
    title: 'intel.commands.handwritingToText',
    keywords: 'intel.commands.handwritingToTextKeywords',
    category: 'object',
    flag: 'intel.handwriting',
    when: () => isEnabled('intel.handwriting') && pageSelection.get().strokes.length > 0,
    run: () => import('./handwriting').then((module) => module.handwritingToText()),
  }),
);

void import('../../intel').then((module) => module.loadApi()).then((api) => api.loadIntel());

// The on-device transcriber behind "Make transcript", so a recording can become text on this device.
if (isEnabled('intel.transcription') && isEnabled('transcripts.block')) {
  void Promise.all([
    import('../../intel').then((module) => module.loadApi()),
    import('../audio/transcripts/engine'),
  ]).then(([api, seam]) => seam.registerTranscriptEngine(api.onDeviceTranscriptEngine));
}

// Dictation (A2-24): press the button or Ctrl+Alt+V, talk, and the words are typed at the cursor.
commands.register(
  defineCommand({
    id: 'intel.dictate',
    title: 'intelMore.dictation.command',
    keywords: 'intelMore.dictation.commandKeywords',
    category: 'insert',
    flag: 'intel.dictation',
    keys: [chord('Ctrl+Alt+V')],
    scope: 'editor',
    allowInTextInput: true,
    run: () => import('./dictation').then((module) => module.toggleDictate()),
  }),
);
commandBar.register({
  id: 'intel.dictate',
  tab: 'home',
  group: 'recording',
  command: 'intel.dictate',
  flag: 'intel.dictation',
  priority: 60,
});

// Live captions (A2-25) follow a recording once the person turned them on in Settings, then Recording.
if (isEnabled('intel.liveCaptions') && isEnabled('intel.transcription')) {
  void import('./captions').then((module) => module.installLiveCaptions());
}
