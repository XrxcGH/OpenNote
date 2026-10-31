// The tutor (the dn-tutor lane, ADR 0050). Three commands sit in the palette; Give me a hint is also in the text
// menu, and each line Check my work flags has Explain this step. The switch is in Settings, then Editing. These are
// definitions only: the tutor loads on first use, and each command asks once to turn the tutor on.
import { commands, contextMenus } from '../../../registries';
import { editingSettingsParts } from '../registries';
import { shownMedia } from '../images/shown';

const chunk = () => import('../tutor/chunk');
const turnedOn = async () => (await import('../../tutor')).askToTurnOnTutor();

commands.register({
  id: 'tutor.open',
  title: 'tutor.commands.open',
  keywords: 'tutor.commands.openKeywords',
  category: 'view',
  icon: 'GraduationCap',
  flag: 'study.tutor',
  run: async () => {
    if (await turnedOn()) await (await chunk()).openTutor();
  },
});
commands.register({
  id: 'tutor.hint',
  title: 'tutor.commands.hint',
  keywords: 'tutor.commands.hintKeywords',
  category: 'view',
  icon: 'Lightbulb',
  flag: 'study.tutor',
  when: () => shownMedia.get() !== null,
  run: async () => {
    if (await turnedOn()) await (await chunk()).hintForSelection();
  },
});
commands.register({
  id: 'tutor.explain',
  title: 'tutor.commands.explain',
  keywords: 'tutor.commands.explainKeywords',
  category: 'view',
  icon: 'ChatCircleText',
  flag: 'study.tutor',
  when: () => shownMedia.get() !== null,
  run: async (_ctx, args?: { index?: number }) => {
    if (await turnedOn()) await (await chunk()).explainStep(args?.index);
  },
});
contextMenus.register({
  id: 'page.text.tutor.hint',
  menu: 'page.text',
  command: 'tutor.hint',
  group: 'math',
  order: 956,
  flag: 'study.tutor',
});
editingSettingsParts.register({
  id: 'study.tutor',
  title: 'tutor.setting.label',
  order: 43,
  flag: 'study.tutor',
  load: () => import('../../tutor').then((tutor) => ({ default: tutor.TutorSetting })),
});
