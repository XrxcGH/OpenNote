// Command types (ARCHITECTURE.md section 14.1). One registry of commands feeds the command bar, the palette,
// menus, the keymap, tooltips, aria-keyshortcuts, and the shortcut list.

import type { FlagId } from '../app/flags';
import type { Location, NavigateOptions } from '../app/location';
import type { KeymapPresetId, Platform } from '../platform/types';
import type { NodeId, NotesService } from '../services/notes/types';
import type { SizeClass } from '../state/layout';
import type { MessageKey } from '../strings/t';
import type { IconName } from '../ui/icons';

export type { KeymapPresetId } from '../platform/types';

/** Such as 'theme.toggle' or 'tree.moveUp'. */
export type CommandId = `${string}.${string}`;
/** The canonical form, such as 'Ctrl+Shift+D': modifiers in the order Ctrl, Alt, Shift, then the key. */
export type Chord = string & { readonly __brand: 'Chord' };
export type KeyScope = 'global' | 'workspace' | 'tree' | 'notebooksTree' | 'pagesTree' | 'palette' | 'dialog';
export type CommandCategory = 'general' | 'navigation' | 'notebooks' | 'view' | 'appearance' | 'updates' | 'help';
export type FocusZone =
  'titleBar' | 'commandBar' | 'notebooks' | 'pages' | 'page' | 'textInput' | 'dialog' | 'palette' | 'none';
export type CommandTarget =
  { kind: 'node'; id: NodeId } | { kind: 'splitter'; pane: 'notebooks' | 'pages' } | { kind: 'trashItem'; id: NodeId };

export interface CommandDef<Args = void> {
  id: CommandId;
  /** Such as 'theme.commands.toggle', "Toggle dark mode". */
  title: MessageKey;
  category: CommandCategory;
  /** Extra palette search words. */
  keywords?: MessageKey;
  icon?: IconName;
  /** The default chords. */
  keys?: readonly Chord[];
  /** Default chords under another shortcut set, such as OneNote's. Missing sets use `keys`. */
  presetKeys?: { readonly [P in KeymapPresetId]?: readonly Chord[] };
  /** Default 'global'. */
  scope?: KeyScope;
  /** For chords such as Ctrl+K that work in text fields. */
  allowInTextInput?: boolean;
  /** The shortcut stays active while a dialog is open. */
  allowInModal?: boolean;
  /** Held keys repeat (moves, pane resizing). Default false. */
  allowRepeat?: boolean;
  /** Default true; false for fixed keys such as Alt+Space. */
  customizable?: boolean;
  /** Available at all; hidden otherwise. */
  when?: (ctx: CommandContext) => boolean;
  /** Shown but disabled when false. */
  enabled?: (ctx: CommandContext) => boolean;
  /** For menuitemcheckbox, menuitemradio, and the palette. */
  checked?: (ctx: CommandContext) => boolean;
  /** Default true. */
  palette?: boolean;
  flag?: FlagId;
  run(ctx: CommandContext, args: Args): void | Promise<void>;
}

export interface CommandContext {
  readonly platform: Platform;
  readonly notes: NotesService;
  readonly focusZone: FocusZone;
  readonly sizeClass: SizeClass;
  /** The row a context menu opened on, for example. */
  readonly target?: CommandTarget;
  readonly source: 'keyboard' | 'palette' | 'menu' | 'commandBar' | 'titleBar' | 'test';
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
  navigate(to: Location, options?: NavigateOptions): void;
}
