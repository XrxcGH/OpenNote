// The item types of the eight extension points (ARCHITECTURE.md section 7.1). Each feature's register.ts adds
// items; the shell, menus, the palette, Settings, setup, and the exit handshake read them.

import type { ComponentType } from 'react';
import type { FlagId } from '../app/flags';
import type { Chord, CommandId } from '../commands/types';
import type { ExitReason, ExitResult, OsAppearance, Platform, Settings, ThemePreference } from '../platform/types';
import type { ChipColor, NotesService } from '../services/notes/types';
import type { MessageKey } from '../strings/t';
import type { IconName } from '../ui/icons';

/** Later phases extend this list. */
export type MenuId =
  | 'tree.notebook'
  | 'tree.sectionGroup'
  | 'tree.section'
  | 'tree.page'
  | 'splitter.notebooks'
  | 'splitter.pages'
  | 'view.paneWidths'
  | 'theme.choices'
  | 'trash.item';

export interface CommandBarItem {
  id: string;
  tab: 'home' | 'insert' | 'draw' | 'view';
  group: string;
  command: CommandId;
  /** Lower priorities move into More first when the bar is narrow. */
  priority: number;
  presentation?: 'button' | 'toggle' | 'menu';
  menu?: MenuId;
  flag?: FlagId;
}

export interface ContextMenuItem {
  id: string;
  menu: MenuId;
  command: CommandId;
  args?: unknown;
  /** Items in the same group sit together; the group 'danger' goes last, after a separator. */
  group: string;
  order: number;
  submenu?: 'color';
  flag?: FlagId;
}

export type SettingsSectionId = 'general' | 'appearance' | 'updates' | 'shortcuts' | 'about' | (string & {});

export interface SettingsSectionDef {
  id: SettingsSectionId;
  title: MessageKey;
  icon: IconName;
  order: number;
  load: () => Promise<{ default: ComponentType }>;
  flag?: FlagId;
}

export type SetupStepId = 'welcome' | 'look' | 'storage' | (string & {});

export interface SetupContext {
  platform: Platform;
  notes: NotesService;
  os: OsAppearance;
  settings: Settings;
  firstRun: boolean;
}

export interface SetupDraft {
  look?: { theme: ThemePreference };
  storage?: { notesFolder: string; moveApp: boolean; notebookName: string; notebookColor: ChipColor };
  [stepId: string]: unknown;
}

export interface SetupStepProps {
  draft: SetupDraft;
  setDraft(update: Partial<SetupDraft>): void;
  stepIndex: number;
  stepCount: number;
  titleId: string;
  progressId: string;
}

export interface SetupStepDef {
  id: SetupStepId;
  title: MessageKey;
  order: number;
  /** Person steps are recorded in settings (roaming); device steps in the device state (local). */
  scope: 'person' | 'device';
  isEnabled(ctx: SetupContext): boolean;
  /** False while the draft can't go on, such as a folder that isn't writable. Default true. */
  canContinue?(draft: SetupDraft): boolean;
  load: () => Promise<{ default: ComponentType<SetupStepProps> }>;
  commit(ctx: SetupContext, draft: SetupDraft): Promise<void>;
}

export interface TitleBarItemDef {
  id: string;
  side: 'start' | 'end';
  order: number;
  /** Lower priorities move into the overflow first. */
  priority: number;
  /** Where the item goes in the compact layout. */
  compact: 'hide' | 'appBar' | 'bottomMore';
  Component: ComponentType<{ presentation: 'full' | 'icon' | 'menuItem' }>;
}

export type PaletteFilterId = 'all' | 'pages' | 'commands';

export interface PaletteResult {
  id: string;
  group: 'commands' | 'notebooks' | 'sections' | 'pages' | (string & {});
  title: string;
  detail?: string;
  keys?: readonly Chord[];
  checked?: boolean;
  icon?: IconName;
  score: number;
  run(): void | Promise<void>;
}

export interface PaletteProvider {
  id: string;
  filter: PaletteFilterId;
  search(query: string, signal: AbortSignal): readonly PaletteResult[] | Promise<readonly PaletteResult[]>;
}

export interface BeforeExitHook {
  id: string;
  /** Lower orders run first. */
  order: number;
  run(reason: ExitReason): Promise<ExitResult>;
}
