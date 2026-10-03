// The Editing section of Settings (PLAN.md section 3.9): it draws the parts the packages register in
// editingSettingsParts. Without it those parts had nowhere to show.
import { settingsSections } from '../../../registries';

settingsSections.register({
  id: 'editing',
  title: 'settings.sections.editing',
  icon: 'PencilSimple',
  // After Appearance, before Updates.
  order: 25,
  flag: 'page.editor',
  load: () => import('../settings/EditingSection'),
});
