// The editor commands behind WP4's page commands (owner: WP4). Each entry turns a command ID and its arguments
// into a ProseMirror command, says whether it is on for the checked state, and names what to announce. The page's
// registrations, the formatting bar, the slash menu, and tests all run commands through here.
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { hostOf } from '../extensions/keys';
import type { HighlightColor, TextSizeName } from '../schema/specs';
import { cycleTodo, insertDivider, toggleCheck } from './blocks';
import { fromChange, runCommand } from './command';
import type { Command } from './command';
import { insertDateTime } from './insertDate';
import { removeLink, setLink } from './links';
import {
  clearFormatting,
  clearFormattingChange,
  currentTextSize,
  setHighlight,
  setTextColor,
  setTextSize,
  stepTextSize,
  toggleHighlight,
  toggleMark,
} from './marks';
import type { ToggledMark } from './marks';
import { blockKindAt, isMarkActive, markAttrs } from './state';
import { toggleKind, turnInto, turnIntoChange } from './turnInto';
import type { BlockKind } from './turnInto';

/** What a command may take: a color, a size, a block kind, or a link. */
export interface EditorCommandArgs {
  color?: string | null;
  size?: TextSizeName | null;
  kind?: BlockKind;
  href?: string;
  text?: string;
}

interface Entry {
  /** The command, or null when it needs arguments it didn't get. */
  command(args: EditorCommandArgs): Command | null;
  /** Whether the command is on at the selection, for toggles. */
  on?(state: EditorState): boolean;
  /** The name to announce: "Bold on" for toggles, "Heading 2" for blocks. */
  name?: MessageKey;
  announce?: 'toggle' | 'block';
}

const mark = (name: ToggledMark, title: MessageKey): Entry => ({
  command: () => toggleMark(name),
  on: (state) => isMarkActive(state, name),
  name: title,
  announce: 'toggle',
});

const kind = (block: BlockKind, title: MessageKey): Entry => ({
  command: () => toggleKind(block),
  on: (state) => blockKindAt(state) === block,
  name: title,
  announce: 'block',
});

const HEADINGS = [1, 2, 3, 4, 5, 6] as const;

const ENTRIES: Record<string, Entry> = {
  'format.bold': mark('bold', 'editor.commands.bold'),
  'format.italic': mark('italic', 'editor.commands.italic'),
  'format.underline': mark('underline', 'editor.commands.underline'),
  'format.strike': mark('strike', 'editor.commands.strike'),
  'format.code': mark('code', 'editor.commands.code'),
  'format.subscript': mark('subscript', 'editor.commands.subscript'),
  'format.superscript': mark('superscript', 'editor.commands.superscript'),
  'format.highlight': {
    command: ({ color }) =>
      color === undefined ? toggleHighlight(null) : setHighlight(color as HighlightColor | null | 'none'),
    on: (state) => isMarkActive(state, 'highlight'),
    name: 'editor.commands.highlight',
    announce: 'toggle',
  },
  'format.larger': { command: () => stepTextSize(1) },
  'format.smaller': { command: () => stepTextSize(-1) },
  'format.textColor': { command: ({ color }) => (color === undefined ? null : setTextColor(color)) },
  'format.textSize': { command: ({ size }) => (size === undefined ? null : setTextSize(size)) },
  'format.clear': { command: () => clearFormatting() },
  'format.clearAll': {
    command: () => fromChange((tr) => [clearFormattingChange(tr), turnIntoChange('paragraph')(tr)].some(Boolean)),
  },
  'format.link': {
    command: ({ href, text }) => (href === undefined ? null : href === '' ? removeLink() : setLink(href, text)),
  },
  'block.normal': kind('paragraph', 'editor.commands.normal'),
  ...Object.fromEntries(
    HEADINGS.map((level) => [
      `block.heading${level}`,
      kind(`heading${level}`, `editor.commands.heading${level}` as MessageKey),
    ]),
  ),
  'block.bulletList': kind('bulletList', 'editor.commands.bulletList'),
  'block.orderedList': kind('orderedList', 'editor.commands.orderedList'),
  'block.checklist': kind('checklist', 'editor.commands.checklist'),
  'block.quote': kind('quote', 'editor.commands.quote'),
  'block.callout': kind('callout', 'editor.commands.callout'),
  'block.codeBlock': {
    command: () => turnInto('codeBlock'),
    on: (state) => blockKindAt(state) === 'codeBlock',
    name: 'editor.commands.codeBlock',
    announce: 'block',
  },
  'block.todoCycle': { command: () => cycleTodo() },
  'block.toggleCheck': { command: () => toggleCheck() },
  'block.divider': { command: () => insertDivider() },
  'block.turnInto': { command: ({ kind: to }) => (to ? turnInto(to) : null) },
  'insert.date': { command: () => insertDateTime('date') },
  'insert.time': { command: () => insertDateTime('time') },
  'insert.dateTime': { command: () => insertDateTime('dateTime') },
};

/** The IDs this catalog runs. */
export const EDITOR_COMMAND_IDS: readonly string[] = Object.keys(ENTRIES);

/** The command for an ID and its arguments, or null when there is none or it needs arguments. */
export function editorCommand(id: string, args: EditorCommandArgs = {}): Command | null {
  return ENTRIES[id]?.command(args) ?? null;
}

/** Whether the command is on at the selection, or undefined for commands that aren't toggles. */
export function commandOn(id: string, state: EditorState): boolean | undefined {
  return ENTRIES[id]?.on?.(state);
}

/** Whether the command would change the document now. */
export function commandApplies(id: string, state: EditorState, args: EditorCommandArgs = {}): boolean {
  const command = editorCommand(id, args);
  return command !== null && command(state);
}

function announcement(id: string, state: EditorState, args: EditorCommandArgs): string | null {
  const entry = ENTRIES[id];
  if (id === 'block.toggleCheck') {
    const checked = state.selection.$from.node(-1)?.attrs.checked;
    return t(checked ? 'editor.announce.checked' : 'editor.announce.unchecked');
  }
  if (id === 'format.larger' || id === 'format.smaller' || (id === 'format.textSize' && args.size !== undefined)) {
    const size = currentTextSize(state);
    return size ? t(`editor.sizes.${size}`) : t('editor.announce.sizeNormal');
  }
  if (id === 'format.link' && args.href === '') return t('editor.announce.linkRemoved');
  if (!entry?.name || !entry.announce) return null;
  const name = t(entry.name);
  if (entry.announce === 'block') return t('editor.announce.block', { name });
  return t(entry.on?.(state) ? 'editor.announce.on' : 'editor.announce.off', { name });
}

/**
 * Runs a command on the editor as one command transaction, then announces the result through the editor's host:
 * "Bold on.", "Heading 2.", "Checked.". Returns whether the command applied.
 */
export function runEditorCommand(
  editor: Editor,
  id: string,
  args: EditorCommandArgs = {},
  options: { focus?: boolean } = {},
): boolean {
  const command = editorCommand(id, args);
  if (!command) return false;
  const ran = runCommand(editor, command, options);
  const text = ran ? announcement(id, editor.state, args) : null;
  if (text) hostOf(editor)?.announce(text);
  return ran;
}

/** The highlight color at the selection: a color name, null for Honey, or undefined without a highlight. */
export function highlightAt(state: EditorState): HighlightColor | null | undefined {
  const attrs = markAttrs(state, 'highlight');
  return attrs ? ((attrs.color as HighlightColor | null) ?? null) : undefined;
}

/** The text color at the selection, or null. */
export function textColorAt(state: EditorState): string | null {
  return (markAttrs(state, 'textColor')?.color as string | undefined) ?? null;
}

export { currentTextSize };
