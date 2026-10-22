// Registers the Language step of setup and the Language section of Settings (flag setup.language for the step).

import { isEnabled } from '../../app/flags';
import { settingsSections, setupSteps } from '../../registries';

setupSteps.register({
  id: 'language',
  title: 'setup.steps.language',
  order: 22,
  scope: 'person',
  isEnabled: (ctx) => ctx.firstRun && isEnabled('setup.language'),
  load: () => import('./LanguageStep'),
  // The choice is saved when a card is picked, and American English is already in settings if none was picked.
  commit: () => Promise.resolve(),
});

settingsSections.register({
  id: 'language',
  title: 'settings.sections.language',
  icon: 'Translate',
  order: 25,
  load: () => import('./LanguageSection'),
});
