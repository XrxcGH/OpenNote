// The item types of the eight extension points (ARCHITECTURE.md section 7.1). Each feature's register.ts adds
// items; the shell, menus, the palette, Settings, setup, and the exit handshake read them.

import type { ComponentType } from 'react';
import type { FlagId } from '../app/flags';
import type { Chord, CommandContext, CommandId } from '../commands/types';
import type { ExitReason, ExitResult, OsAppearance, Platform, Settings, ThemePreference } from '../platform/types';
import type { ChipColor, NodeId, NotesService } from '../services/notes/types';
import type { MessageKey } from '../strings/t';
import type { IconName } from '../ui/icons';

/** Later phases extend this list: Phase 4's page and history menus and Phase 5's ink menus (AMENDMENTS.md P2-1). */
export type MenuId =
  | 'tree.notebook'
  | 'tree.sectionGroup'
  | 'tree.section'
  | 'tree.page'
  | 'splitter.notebooks'
  | 'splitter.pages'
  | 'view.paneWidths'
  | 'theme.choices'
  | 'trash.item'
  | 'page.text'
  | 'page.link'
  | 'page.object'
  | 'page.image'
  | 'page.table'
  | 'page.canvas'
  | 'history.version'
  | 'history.change'
  | 'page.ink'
  | 'ink.penSlot'
  | 'ink.palette';

/**
 * Props of a command bar item that draws itself, such as Phase 5's pen swatches (AMENDMENTS.md, Phase 5 P2-4).
 * Spread `toolProps` on every focusable control inside, so the toolbar's arrow keys reach each one.
 */
export interface CommandBarComponentProps {
  toolProps: { tabIndex: -1; 'data-tool': '' };
}

export interface CommandBarItem {
  id: string;
  tab: 'home' | 'insert' | 'draw' | 'view';
  group: string;
  /** Also what the item runs from the More menu when the bar is too narrow to show it. */
  command: CommandId;
  /** Lower priorities move into More first when the bar is narrow. */
  priority: number;
  presentation?: 'button' | 'toggle' | 'menu' | 'component';
  menu?: MenuId;
  /** With presentation 'component'. */
  Component?: ComponentType<CommandBarComponentProps>;
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
  /** The pen name of the notebook color to show as a small chip before the title, as the tree does. */
  ink?: string;
  keys?: readonly Chord[];
  checked?: boolean;
  /** Shown, but not run: a command whose `enabled` is false. */
  disabled?: boolean;
  icon?: IconName;
  score: number;
  run(): void | Promise<void>;
}

export interface PaletteProvider {
  id: string;
  filter: PaletteFilterId;
  search(query: string, signal: AbortSignal): readonly PaletteResult[] | Promise<readonly PaletteResult[]>;
}

/**
 * A table of its own in the keyboard shortcut list (Ctrl+/), after the commands and the fixed keys, such as
 * Phase 5's "Pen and touch gestures" (AMENDMENTS.md, Phase 5 P2-5). The component renders the table; the list
 * renders the heading from `title`.
 */
export interface ShortcutListSectionDef {
  id: string;
  title: MessageKey;
  order: number;
  Component: ComponentType;
  flag?: FlagId;
}

/**
 * What a beforeExit hook answers. A refusal can carry `message`, a sentence the hook built, in place of the reason
 * key's text. It can also offer `closeAnyway`, which makes the hook let the next close through at the cost of what
 * it protects. The toast then has a "Close anyway" action, so a refusal that can't clear itself, such as notes
 * that can't be saved, never traps the person in the app.
 */
export type BeforeExitAnswer =
  | { ok: true }
  | { ok: false; reason: Extract<ExitResult, { ok: false }>['reason']; message?: string; closeAnyway?: () => void };

export interface BeforeExitHook {
  id: string;
  /** Lower orders run first. */
  order: number;
  run(reason: ExitReason): Promise<BeforeExitAnswer>;
}

/**
 * Runs after notes.newPage or notes.newSubpage creates a page, such as Phase 4's date and time line under the
 * title. A hook that fails is logged and doesn't undo the page.
 */
export interface PageCreatedHook {
  id: string;
  /** Lower orders run first. */
  order: number;
  run(pageId: NodeId, ctx: CommandContext): Promise<void>;
}
