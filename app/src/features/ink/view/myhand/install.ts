// My handwriting's registrations (flag ink.myHandwriting): Write in my handwriting, Type as handwriting, their place
// in the text menu and the Draw tab, the Settings section, and test hooks. more.ts calls it with the view's seams.
import { isEnabled } from '../../../../app/flags';
import type { CommandDef } from '../../../../commands/types';
import { commandBar, commands, contextMenus, settingsSections } from '../../../../registries';
import { createStore } from '../../../../state/store';
import { showToast } from '../../../../ui';
import { t } from '../../../../strings/t';
import type { InkHost } from '../host';
import type { InkSurface } from '../surface';

/** Whether Type as handwriting is on, for the command's checked state. */
export const typing = createStore<boolean>(false, 'type as handwriting');
let mode: { stop(): void } | null = null;

async function toggleTyping(host: InkHost, surface: InkSurface | null): Promise<void> {
  if (mode) {
    mode.stop();
    return;
  }
  if (!surface || surface.readOnly) return;
  const [{ currentStyle }, { TypeMode }] = await Promise.all([import('./writeInk'), import('./typeMode')]);
  const style = await currentStyle();
  if (!style) {
    showToast({ message: t('myHand.write.noStyle') });
    return;
  }
  typing.set(true);
  mode = new TypeMode(host, surface, style, () => {
    mode = null;
    typing.set(false);
  });
}

export function installMyHand(host: InkHost, surface: () => InkSurface | null): () => void {
  const defs: CommandDef[] = [
    {
      id: 'ink.myHandwriting.write',
      title: 'myHand.write.command',
      keywords: 'myHand.write.keywords',
      category: 'editing',
      flag: 'ink.myHandwriting',
      when: () => host.text?.selection !== undefined,
      run: () => {
        const current = surface();
        if (current) void import('./writeInk').then((module) => module.writeSelection(host, current));
      },
    },
    {
      id: 'ink.myHandwriting.type',
      title: 'myHand.type.command',
      keywords: 'myHand.type.keywords',
      category: 'editing',
      flag: 'ink.myHandwriting',
      checked: () => typing.get(),
      run: () => void toggleTyping(host, surface()),
    },
  ];
  const stops = defs.map((def) => commands.register(def));
  stops.push(
    contextMenus.register({
      id: 'page.text.myHandwriting',
      menu: 'page.text',
      command: 'ink.myHandwriting.write',
      group: 'convert',
      order: 60,
      flag: 'ink.myHandwriting',
    }),
    commandBar.register({
      id: 'ink.myHandwriting.type',
      tab: 'draw',
      group: 'tools',
      command: 'ink.myHandwriting.type',
      priority: 28,
      presentation: 'toggle',
      flag: 'ink.myHandwriting',
    }),
    settingsSections.register({
      id: 'myHandwriting',
      title: 'myHand.section',
      icon: 'PenNib',
      order: 27,
      flag: 'ink.myHandwriting',
      load: () => import('./MyHandSection'),
    }),
  );
  if (import.meta.env.MODE === 'test' && typeof window !== 'undefined' && isEnabled('ink.myHandwriting')) {
    void import('./testHooks').then((module) => stops.push(module.installMyHandTestHooks()));
  }
  return () => {
    mode?.stop();
    stops.reverse().forEach((stop) => stop());
  };
}
