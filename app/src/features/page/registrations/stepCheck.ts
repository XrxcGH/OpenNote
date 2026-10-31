// Check my work (the dn-stepcheck lane): one command, offered from the palette, the slash menu, the text menu, and
// the lasso menu (ink/view/selection.ts runs the command), plus its switch in Settings, then Editing. Definitions
// only; the work loads on first use.
import { commands, contextMenus } from '../../../registries';
import { editingSettingsParts, slashItems } from '../registries';
import { shownMedia } from '../images/shown';
import { checkWorkOn } from '../stepcheck/choice';

commands.register({
  id: 'math.checkWork',
  title: 'stepCheck.command',
  keywords: 'stepCheck.commandKeywords',
  category: 'view',
  icon: 'ListChecks',
  flag: 'math.checkWork',
  when: () => checkWorkOn() && shownMedia.get() !== null,
  run: async () => (await import('../stepcheck/run')).checkMyWork(),
});
slashItems.register({
  id: 'math.checkWork',
  title: 'stepCheck.slash',
  keywords: 'stepCheck.slashKeywords',
  icon: 'ListChecks',
  flag: 'math.checkWork',
  command: 'math.checkWork',
  group: 'advanced',
  order: 27,
});
contextMenus.register({
  id: 'page.text.math.checkWork',
  menu: 'page.text',
  command: 'math.checkWork',
  group: 'math',
  order: 955,
  flag: 'math.checkWork',
});
editingSettingsParts.register({
  id: 'math.checkWork',
  title: 'stepCheck.setting.label',
  order: 42,
  flag: 'math.checkWork',
  load: () => import('../stepcheck/CheckWorkSetting'),
});
