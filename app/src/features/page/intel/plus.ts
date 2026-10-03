// The registrations for the quality-of-life parts of on-device intelligence (Phase 12): commands for the custom
// vocabulary and background work. Like register.ts, it runs once start-up is done, and the work loads on first use
// through the intel feature's index. The setup step registers at start-up instead (registrations/intel.ts), because
// first-run setup reads its steps at once.
import { isEnabled } from '../../../app/flags';
import { defineCommand } from '../../../commands/registry';
import { commands } from '../../../registries';
import { t } from '../../../strings/t';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import type { MountedPage, MountedPageHook } from '../pagesApi';

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

// Reads the text in images the page shows that the device hasn't read yet, through the activity panel's queue. It
// does nothing while text in images is off, and it never asks to turn it on.
const imageTextHook: MountedPageHook = {
  id: 'intel.backgroundImageText',
  attach(mounted: MountedPage) {
    if (!isEnabled('intel.backgroundOcr')) return () => undefined;
    let active = true;
    let stop: () => void = () => undefined;
    void api().then((module) => {
      if (active) {
        stop = module.watchImagesForText(
          mounted.viewport.world,
          (img) => img.alt || t('intelPlus.background.unnamedImage'),
        );
      }
    });
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
