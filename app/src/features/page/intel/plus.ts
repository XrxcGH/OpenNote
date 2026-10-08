// The registrations for the quality-of-life parts of on-device intelligence (Phase 12): commands for the custom
// vocabulary and background work. Like register.ts, it runs once start-up is done, and the work loads on first use
// through the intel feature's index. The setup step registers at start-up instead (registrations/intel.ts), because
// first-run setup reads its steps at once.
import { isEnabled } from '../../../app/flags';
import { defineCommand } from '../../../commands/registry';
import { commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import type { MountedPage, MountedPageHook } from '../pagesApi';
import { hasTextSelection } from './selection';

const api = () => import('../../intel').then((module) => module.loadApi());

commands.register(
  defineCommand({
    id: 'intel.editVocabulary',
    title: 'intelPlus.vocabulary.editCommand',
    keywords: 'intelPlus.vocabulary.editKeywords',
    category: 'view',
    flag: 'intel.vocabulary',
    run: () => api().then((module) => module.editVocabularyForCurrentNotebook()),
  }),
);

commands.register(
  defineCommand({
    id: 'intel.showBackgroundWork',
    title: 'intelPlus.background.openCommand',
    keywords: 'intelPlus.background.openKeywords',
    category: 'view',
    flag: 'intel.background',
    run: () => api().then((module) => module.openActivityPanel()),
  }),
);

commands.register(
  defineCommand({
    id: 'intel.findByMeaning',
    title: 'intelPlus.meaning.findCommand',
    keywords: 'intelPlus.meaning.findKeywords',
    category: 'navigation',
    flag: 'intel.meaning',
    run: () => api().then((module) => module.openFindByMeaning()),
  }),
);

commands.register(
  defineCommand({
    id: 'intel.relatedPages',
    title: 'intelPlus.meaning.relatedCommand',
    keywords: 'intelPlus.meaning.relatedKeywords',
    category: 'view',
    flag: 'intel.meaning',
    run: () => api().then((module) => module.toggleRelatedPages()),
  }),
);

commands.register(
  defineCommand({
    id: 'intel.askNotes',
    title: 'intelPlus.ask.command',
    keywords: 'intelPlus.ask.keywords',
    category: 'navigation',
    flag: 'intel.ask',
    run: () => api().then((module) => module.openAsk()),
  }),
);

// Writing tools: five commands on the selected text, each also in the text menu. A suggestion is shown with its changes
// marked, and nothing is replaced until the person accepts it.
const WRITING_TOOLS = [
  ['proofread', 'intel.proofread'],
  ['rewrite', 'intel.rewrite'],
  ['shorten', 'intel.shorten'],
  ['list', 'intel.makeList'],
  ['tidy', 'intel.tidyStructure'],
] as const;

WRITING_TOOLS.forEach(([tool, id], order) => {
  commands.register(
    defineCommand({
      id,
      title: `intelPlus.writing.tools.${tool}`,
      keywords: 'intelPlus.writing.keywords',
      category: 'editing',
      flag: 'intel.writing',
      when: hasTextSelection,
      run: () => import('./writing').then((module) => module.runWritingTool(tool)),
    }),
  );
  contextMenus.register({
    id,
    menu: 'page.text',
    command: id,
    group: 'intel',
    order: 40 + order,
    flag: 'intel.writing',
  });
});

// Search by meaning keeps its index current: it reads the page that opens, and at start-up it catches up on the rest.
void api().then((module) => module.resumeExtras());

// Reads the text in images the page shows that the device hasn't read yet, through the activity panel's queue, and
// indexes the page for search by meaning. It does nothing while text in images is off, never asks to turn it on, and
// keeps nothing of a page in an encrypted section.
const imageTextHook: MountedPageHook = {
  id: 'intel.backgroundImageText',
  attach(mounted: MountedPage) {
    let active = true;
    let stop: () => void = () => undefined;
    const reads = isEnabled('intel.backgroundOcr');
    const meaning = isEnabled('intel.meaning');
    if (reads || meaning) {
      void api().then(async (module) => {
        if (await module.pageIsProtected(mounted.page.initial.id)) return;
        if (meaning) module.indexPage({ ...mounted.page.initial });
        if (active && reads) {
          stop = module.watchImagesForText(
            mounted.viewport.world,
            (img) => img.alt || t('intelPlus.background.unnamedImage'),
          );
        }
      });
    }
    return () => {
      active = false;
      stop();
    };
  },
};
mountedPageHooks.register(imageTextHook);
// The page that is already shown missed the hook, so it attaches now.
const shown = shownMounted.get();
if (shown) imageTextHook.attach(shown);
