// WP4's registrations: the formatting, block, and typing commands in both shortcut sets. It also adds their items
// on the Home and Insert tabs, and the page.text and page.link menus. This file loads at start-up, so it holds
// only definitions. Running a command loads formattingBar/commands.ts; checked states read the selection directly.
import type { Editor } from '@tiptap/core';
import type { FlagId } from '../../../app/flags';
import { menuItemsFor } from '../../../commands/menus';
import { commandContext, defineCommand } from '../../../commands/registry';
import type { CommandCategory, CommandContext, CommandId } from '../../../commands/types';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import {
  MERGE_BLOCKS_EVENT,
  blockKindAt,
  caretInLink,
  inTaskItem,
  isMarkActive,
  linkApplies,
  marksAllowed,
} from '../../../editor/commands/state';
import type { BlockKindName, MergeBlocksDetail } from '../../../editor/commands/state';
import { commandBar, commands, contextMenus } from '../../../registries';
import type { CommandBarItem, ContextMenuItem } from '../../../registries/types';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { editMenu, registerAppMenu } from '../../../ui/appMenu';
import { targetEditor } from '../formattingBar/target';
import { registerPageCommand } from '../keys';
import type { PageCommandId } from '../keys';

const formatting = () => import('../formattingBar/commands');

interface EditorCommand {
  id: PageCommandId;
  title: MessageKey;
  keywords?: MessageKey;
  category?: CommandCategory;
  flag?: FlagId;
  /** Whether it is on at the selection; makes the command a toggle. */
  on?(editor: Editor): boolean;
  /** Whether it applies at the selection; when false, its key goes on to less specific commands. */
  applies?(editor: Editor, ctx: CommandContext): boolean;
}

const withEditor =
  <T>(read: (editor: Editor) => T, otherwise: T) =>
  (): T => {
    const editor = targetEditor();
    return editor ? read(editor) : otherwise;
  };

function register({ id, title, keywords, category = 'format', flag = 'page.editor', on, applies }: EditorCommand) {
  registerPageCommand<EditorCommandArgs | undefined>({
    id,
    title,
    ...(keywords ? { keywords } : {}),
    category,
    flag,
    when: () => targetEditor() !== null,
    ...(applies
      ? {
          enabled: (ctx: CommandContext) => {
            const editor = targetEditor();
            return editor !== null && applies(editor, ctx);
          },
        }
      : {}),
    ...(on ? { checked: withEditor(on, false) } : {}),
    run: async (_ctx, args) => (await formatting()).runFormatting(id, args),
  });
}

const markOn = (name: string) => (editor: Editor) => isMarkActive(editor.state, name);
const kindOn = (kind: BlockKindName) => (editor: Editor) => blockKindAt(editor.state) === kind;
const canMark = (editor: Editor) => marksAllowed(editor.state);

const MARKS = ['bold', 'italic', 'underline', 'strike', 'highlight', 'code', 'subscript', 'superscript'] as const;
for (const name of MARKS) {
  const id = `format.${name}` as const;
  register({
    id,
    title: `editor.commands.${name}`,
    keywords: 'editor.keywords.marks',
    on: markOn(name),
    applies: canMark,
  });
}

const FORMATS: readonly EditorCommand[] = [
  { id: 'format.larger', title: 'editor.commands.larger', keywords: 'editor.keywords.size', applies: canMark },
  { id: 'format.smaller', title: 'editor.commands.smaller', keywords: 'editor.keywords.size', applies: canMark },
  { id: 'format.textColor', title: 'editor.commands.textColor', keywords: 'editor.keywords.color', applies: canMark },
  { id: 'format.textSize', title: 'editor.commands.textSize', keywords: 'editor.keywords.size', applies: canMark },
  { id: 'format.clear', title: 'editor.commands.clear', keywords: 'editor.keywords.clear' },
  { id: 'format.clearAll', title: 'editor.commands.clearAll', keywords: 'editor.keywords.clear' },
  {
    id: 'format.link',
    title: 'editor.commands.link',
    keywords: 'editor.keywords.link',
    category: 'insert',
    // Ctrl+K edits a link with text selected or the caret in one; otherwise it opens the palette.
    applies: (editor, ctx) => marksAllowed(editor.state) && (ctx.source !== 'keyboard' || linkApplies(editor.state)),
  },
];
FORMATS.forEach(register);

/** Block kinds by command: block.normal is a paragraph, and the rest share their kind's name. */
const KINDS = [
  'normal',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'bulletList',
  'orderedList',
  'checklist',
  'quote',
  'callout',
  'codeBlock',
] as const;
for (const name of KINDS) {
  const kind: BlockKindName = name === 'normal' ? 'paragraph' : name;
  const lists = name.endsWith('List') || name === 'checklist';
  const keywords: MessageKey = lists ? 'editor.keywords.list' : 'editor.keywords.block';
  register({ id: `block.${name}`, title: `editor.commands.${name}`, keywords, on: kindOn(kind) });
}

register({ id: 'block.todoCycle', title: 'editor.commands.todoCycle', keywords: 'editor.keywords.task' });
register({
  id: 'block.toggleCheck',
  title: 'editor.commands.toggleCheck',
  keywords: 'editor.keywords.task',
  applies: (editor) => inTaskItem(editor.state),
});
register({
  id: 'block.divider',
  title: 'editor.commands.divider',
  keywords: 'editor.keywords.insert',
  category: 'insert',
});
register({
  id: 'block.turnInto',
  title: 'editor.commands.turnInto',
  keywords: 'editor.keywords.block',
  flag: 'page.slashMenu',
});

const DATES: readonly [PageCommandId, MessageKey][] = [
  ['insert.date', 'editor.commands.date'],
  ['insert.time', 'editor.commands.time'],
  ['insert.dateTime', 'editor.commands.dateTime'],
];
for (const [id, title] of DATES) {
  register({ id, title, keywords: 'editor.keywords.date', category: 'insert', flag: 'page.typingHelpers' });
}

registerPageCommand<{ color?: string | null } | undefined>({
  id: 'text.setColor',
  title: 'editor.commands.setColor',
  keywords: 'editor.keywords.color',
  category: 'format',
  flag: 'page.editor',
  run: async (ctx, args) => (await formatting()).setBlocksColor(args?.color, ctx),
});

// The link menu's commands. They have no keys, so they live outside the keys table.
const inLink = withEditor((editor) => caretInLink(editor.state), false);
const LINK_COMMANDS: readonly { id: CommandId; title: MessageKey; run(ctx: CommandContext): Promise<void> }[] = [
  { id: 'link.open', title: 'editor.link.open', run: async (ctx) => (await formatting()).openLinkAtCaret(ctx) },
  { id: 'link.copy', title: 'editor.link.copy', run: async (ctx) => (await formatting()).copyLinkAtCaret(ctx) },
  {
    id: 'link.edit',
    title: 'editor.link.edit',
    run: async () => (await formatting()).runFormatting('format.link', {}),
  },
  {
    id: 'link.remove',
    title: 'editor.link.remove',
    run: async () => (await formatting()).runFormatting('format.link', { href: '' }),
  },
];
for (const { id, title, run } of LINK_COMMANDS) {
  commands.register(
    defineCommand({
      id,
      title,
      category: 'editing',
      scope: 'editor',
      flag: 'page.editor',
      palette: false,
      when: inLink,
      run,
    }),
  );
}

const bar = (item: Omit<CommandBarItem, 'id' | 'tab'> & { tab?: CommandBarItem['tab'] }): CommandBarItem => ({
  id: `editor.${item.command}`,
  tab: 'home',
  ...item,
});
const BAR: readonly CommandBarItem[] = [
  bar({ group: 'text', command: 'format.bold', priority: 70, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.italic', priority: 69, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.underline', priority: 68, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.strike', priority: 40, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.highlight', priority: 67, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.textColor', priority: 45 }),
  bar({ group: 'text', command: 'format.textSize', priority: 30 }),
  bar({ group: 'text', command: 'format.subscript', priority: 20, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.superscript', priority: 20, presentation: 'toggle' }),
  bar({ group: 'text', command: 'format.clear', priority: 35 }),
  bar({ group: 'paragraph', command: 'block.bulletList', priority: 66, presentation: 'toggle' }),
  bar({ group: 'paragraph', command: 'block.orderedList', priority: 65, presentation: 'toggle' }),
  bar({ group: 'paragraph', command: 'block.checklist', priority: 64, presentation: 'toggle' }),
  bar({ group: 'paragraph', command: 'block.toggleCheck', priority: 38 }),
  bar({ group: 'styles', command: 'block.normal', priority: 50, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.heading1', priority: 49, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.heading2', priority: 48, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.heading3', priority: 47, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.turnInto', priority: 25, flag: 'page.slashMenu' }),
  bar({ tab: 'insert', group: 'text', command: 'format.link', priority: 60 }),
  bar({ tab: 'insert', group: 'blocks', command: 'block.codeBlock', priority: 50 }),
  bar({ tab: 'insert', group: 'blocks', command: 'block.callout', priority: 49 }),
  bar({ tab: 'insert', group: 'blocks', command: 'block.divider', priority: 48 }),
  bar({ tab: 'insert', group: 'dates', command: 'insert.date', priority: 30, flag: 'page.typingHelpers' }),
  bar({ tab: 'insert', group: 'dates', command: 'insert.time', priority: 29, flag: 'page.typingHelpers' }),
  bar({ tab: 'insert', group: 'dates', command: 'insert.dateTime', priority: 28, flag: 'page.typingHelpers' }),
];
BAR.forEach((item) => commandBar.register(item));

const MENU: readonly ContextMenuItem[] = [
  { id: 'editor.text.bold', menu: 'page.text', command: 'format.bold', group: 'format', order: 10 },
  { id: 'editor.text.italic', menu: 'page.text', command: 'format.italic', group: 'format', order: 20 },
  { id: 'editor.text.highlight', menu: 'page.text', command: 'format.highlight', group: 'format', order: 30 },
  { id: 'editor.text.turnInto', menu: 'page.text', command: 'block.turnInto', group: 'block', order: 10 },
  { id: 'editor.text.link', menu: 'page.text', command: 'format.link', group: 'block', order: 20 },
  { id: 'editor.link.open', menu: 'page.link', command: 'link.open', group: 'link', order: 10 },
  { id: 'editor.link.copy', menu: 'page.link', command: 'link.copy', group: 'link', order: 20 },
  { id: 'editor.link.edit', menu: 'page.link', command: 'link.edit', group: 'link', order: 30 },
  { id: 'editor.link.remove', menu: 'page.link', command: 'link.remove', group: 'link', order: 40 },
];
MENU.forEach((item) => contextMenus.register(item));

// The text editors' context menu: the link's items when it opened on a link, then Cut, Copy, and Paste, then the
// page.text items that every package registers.
registerAppMenu('page.text', (context) => {
  const ctx = commandContext('menu');
  const clipboard = editMenu(context).items.filter((item) => item.id !== 'selectAll');
  const link = context.target.closest('a[href]') ? menuItemsFor('page.link', ctx) : [];
  const text = menuItemsFor('page.text', ctx);
  const sections = [link, clipboard, text].filter((items) => items.length > 0);
  const items = sections.flatMap((section, index) =>
    section.map((item, at) => (at === 0 && index > 0 ? { ...item, separatorBefore: true } : item)),
  );
  return { label: t('editor.textMenu'), items };
});

// Backspace at the start of a flowing text block asks the page to merge it into the block above.
if (typeof document !== 'undefined') {
  document.addEventListener(MERGE_BLOCKS_EVENT, (event) => {
    const { detail } = event as CustomEvent<MergeBlocksDetail>;
    void import('../formattingBar/merge').then(({ mergeIntoPrevious }) => mergeIntoPrevious(detail));
  });
}
