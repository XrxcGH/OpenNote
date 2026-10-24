// Phase 12's registrations: the On-device intelligence section of Settings, and, once start-up is done, the
// commands (intel/register.ts). It stays tiny for the start-up bundle: the work loads on first use, and the
// features/intel code loads when Settings shows or a command runs.
import { isEnabled } from '../../../app/flags';
import { settingsSections, setupSteps } from '../../../registries';

settingsSections.register({
  id: 'intel',
  title: 'intel.settings.title',
  icon: 'Sparkle',
  // After Editing, before Updates.
  order: 27,
  load: () => import('../../intel').then((module) => module.loadSettingsSection()),
});

// The smart features step of first-run setup. Setup reads its steps at once, so this registers at start-up, and the
// step's screen loads only when setup shows it. It sits after the look and before the storage step, which stays last.
setupSteps.register({
  id: 'smartFeatures',
  title: 'intelPlus.smart.title',
  order: 25,
  scope: 'device',
  isEnabled: () => isEnabled('setup.smartFeatures'),
  load: () => import('../../intel').then((module) => module.loadSmartFeaturesStep()),
  commit: (ctx, draft) => import('../../intel').then((module) => module.commitSmartFeatures(ctx, draft)),
});

const start = () => {
  void import('../intel/register');
  void import('../intel/plus');
};
// A unit or component test that loads the page registrations may end before the idle callback runs, and then the
// late import fails after its environment is gone. No such test needs the commands, so they wait for the app.
if (typeof window !== 'undefined' && !import.meta.env.VITEST) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1000);
}
