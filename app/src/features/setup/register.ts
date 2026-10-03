// Registers the three setup steps of Phase 2 (ARCHITECTURE.md section 17.1). Later phases add steps the same way.
// Each step's screen loads only when the step shows.

import { setupSteps } from '../../registries';
import { commitLook } from './steps/look';
import { canContinueStorage, commitStorage } from './steps/storage';

setupSteps.register({
  id: 'welcome',
  title: 'setup.steps.welcome',
  order: 10,
  scope: 'person',
  isEnabled: () => true,
  load: () => import('./steps/WelcomeStep'),
  commit: () => Promise.resolve(),
});

setupSteps.register({
  id: 'look',
  title: 'setup.steps.look',
  order: 20,
  scope: 'person',
  isEnabled: () => true,
  load: () => import('./steps/LookStep'),
  commit: commitLook,
});

setupSteps.register({
  id: 'storage',
  title: 'setup.steps.storage',
  order: 30,
  scope: 'device',
  isEnabled: () => true,
  canContinue: canContinueStorage,
  load: () => import('./steps/StorageStep'),
  commit: commitStorage,
});
