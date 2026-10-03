// The audio lane's later registrations (quality of life after Phase 9): the Recording section of Settings, and, as
// each feature lands, its commands. This file loads at start-up, so it holds definitions only; the screens and the
// work load on first use.
import { settingsSections } from '../../../registries';

settingsSections.register({
  id: 'recording',
  title: 'audioMore.settings.title',
  icon: 'Microphone',
  // After Editing, before On-device intelligence.
  order: 26,
  flag: 'settings.recording',
  load: () => import('../audio/SettingsSection'),
});
