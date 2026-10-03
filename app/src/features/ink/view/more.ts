// The registrations of the ink lane's later features: commands, Draw tab items, and the installers of the pieces that
// sit beside the pen tool. install.ts calls it once, so the rest of the view stays as it was. Each feature adds its
// own block here, behind its own flag.
import type { Chord, CommandDef } from '../../../commands/types';
import { commandBar, commands } from '../../../registries';
import { toggleCanvasLock, installCanvasLock } from './canvasLock';
import { describeDrawing } from './describe';
import { DrawOptions } from './DrawOptions';
import type { InkHost } from './host';
import { installHover } from './hover';
import { inkPrefs, setPrefs } from './prefs';
import type { InkSurface } from './surface';

/** What the later features need from the view that installed them. */
export interface MoreContext {
  readonly host: InkHost;
  readonly surface: () => InkSurface | null;
}

const chord = (value: string) => value as Chord;

export function installMore(context: MoreContext): () => void {
  const { host, surface } = context;
  const stops: (() => void)[] = [installHover(surface), installCanvasLock(host)];
  const defs: CommandDef[] = [
    {
      id: 'ink.canvasLock',
      title: 'ink.canvasLock.title',
      keywords: 'ink.canvasLock.keywords',
      category: 'view',
      keys: [chord('Ctrl+Alt+Shift+L')],
      flag: 'ink.canvasLock',
      checked: () => inkPrefs.get().canvasLock,
      run: toggleCanvasLock,
    },
    {
      id: 'ink.hover',
      title: 'ink.hover.title',
      keywords: 'ink.hover.keywords',
      category: 'view',
      flag: 'ink.hover',
      checked: () => inkPrefs.get().hover,
      run: () => setPrefs({ hover: !inkPrefs.get().hover }),
    },
    {
      id: 'ink.describe',
      title: 'ink.describe.title',
      keywords: 'ink.describe.keywords',
      category: 'editing',
      flag: 'ink.describe',
      run: () => {
        const current = surface();
        if (current) void describeDrawing(host, current);
      },
    },
  ];
  for (const def of defs) stops.push(commands.register(def));
  stops.push(
    commandBar.register({
      id: 'ink.options',
      tab: 'draw',
      group: 'tools',
      command: 'ink.lasso',
      priority: 70,
      presentation: 'component',
      Component: DrawOptions,
      flag: 'ink.erasers',
    }),
    commandBar.register({
      id: 'ink.canvasLock',
      tab: 'draw',
      group: 'view',
      command: 'ink.canvasLock',
      priority: 40,
      presentation: 'toggle',
      flag: 'ink.canvasLock',
    }),
    commandBar.register({
      id: 'ink.describe',
      tab: 'draw',
      group: 'review',
      command: 'ink.describe',
      priority: 20,
      presentation: 'button',
      flag: 'ink.describe',
    }),
  );
  return () => stops.reverse().forEach((stop) => stop());
}
