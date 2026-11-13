// The ruler's registrations (lane text:ruler): View, Ruler shows the ruler above the focused text block. This file
// loads at start-up, so it holds only the command; the ruler's code loads with the page.
import { commandBar, commands } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { rulerState, setRulerShown } from '../ruler/store';
import { shownQueue } from '../sync/shown';

commands.register({
  id: 'view.ruler',
  title: 'textRuler.toggle',
  keywords: 'textRuler.toggleKeywords',
  category: 'view',
  icon: 'Ruler',
  flag: 'text.ruler',
  when: () => shownQueue.get() !== null,
  checked: () => rulerState.get().shown,
  run: () => {
    const shown = !rulerState.get().shown;
    setRulerShown(shown);
    announce(t(shown ? 'textRuler.shown' : 'textRuler.hidden'));
  },
});

commandBar.register({
  id: 'view.ruler',
  tab: 'view',
  group: 'pageTools',
  command: 'view.ruler',
  priority: 70,
  presentation: 'toggle',
  flag: 'text.ruler',
});
