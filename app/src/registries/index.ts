// The eight extension points (ARCHITECTURE.md section 7.1). Features register into them from register.ts.

import type { CommandDef } from '../commands/types';
import { createRegistry } from './registry';
import type {
  BeforeExitHook,
  CommandBarItem,
  ContextMenuItem,
  PaletteProvider,
  SettingsSectionDef,
  SetupStepDef,
  TitleBarItemDef,
} from './types';

export { createRegistry, useRegistry } from './registry';
export type { Registry } from './registry';
export type * from './types';

// Commands take different argument types, so the registry holds them as CommandDef<any>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commands = createRegistry<CommandDef<any>>('commands');
export const commandBar = createRegistry<CommandBarItem>('command bar');
export const contextMenus = createRegistry<ContextMenuItem>('context menus');
export const settingsSections = createRegistry<SettingsSectionDef>('settings sections');
export const setupSteps = createRegistry<SetupStepDef>('setup steps');
export const titleBarItems = createRegistry<TitleBarItemDef>('title bar items');
export const paletteProviders = createRegistry<PaletteProvider>('palette providers');
export const beforeExit = createRegistry<BeforeExitHook>('before-exit hooks');
