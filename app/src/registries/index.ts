// The extension points (ARCHITECTURE.md section 7.1), plus the page created hooks (amendment P2-8). Features
// register into them from register.ts.

import type { CommandDef } from '../commands/types';
import { createRegistry } from './registry';
import type {
  BeforeExitHook,
  CommandBarItem,
  ContextMenuItem,
  ExportInkSource,
  PageCreatedHook,
  PaletteProvider,
  SettingsSectionDef,
  SetupStepDef,
  ShortcutListSectionDef,
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
/** Phase 4 amendment P2-8: hooks that notes.newPage and notes.newSubpage run after creating a page. */
export const pageCreated = createRegistry<PageCreatedHook>('page created hooks');
/** Tables that later phases add to the keyboard shortcut list (AMENDMENTS.md, Phase 5 P2-5). */
export const shortcutListSections = createRegistry<ShortcutListSectionDef>('shortcut list sections');
/** Phase 6's print and export read a page's ink from these; Phase 5's ink view registers the shown page's. */
export const exportInkSources = createRegistry<ExportInkSource>('export ink sources');
