// WP4's registrations: the formatting, block, and typing commands in both shortcut sets. It also adds their items
// on the Home and Insert tabs, and the page.text and page.link menus. This file loads at start-up, so it holds
// only definitions. Running a command loads formattingBar/commands.ts; checked states read the selection directly.
import type { Editor } from '@tiptap/core';
import { isEnabled } from '../../../app/flags';
import type { FlagId } from '../../../app/flags';
import { getLocation, onNavigate } from '../../../app/location';
import { menuItemsFor } from '../../../commands/menus';
import { commandContext, defineCommand } from '../../../commands/registry';
import type { CommandCategory, CommandContext, CommandId } from '../../../commands/types';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import {
  FOLDS_EVENT,
  FOLDS_REQUEST_EVENT,
  MERGE_BLOCKS_EVENT,
  SLASH_MENU_EVENT,
  blockKindAt,
  caretInLink,
  inTaskItem,
  isMarkActive,
  linkApplies,
  marksAllowed,
} from '../../../editor/commands/state';
import type { BlockKindName, FoldsDetail, FoldsRequestDetail, MergeBlocksDetail } from '../../../editor/commands/state';
import { commandBar, commands, contextMenus, pageCreated } from '../../../registries';
import type { CommandBarItem, ContextMenuItem } from '../../../registries/types';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { editMenu, registerAppMenu } from '../../../ui/appMenu';
import { targetEditor } from '../formattingBar/target';
import { getSettings } from '../../../state/settings';
import { registerPageCommand } from '../keys';
import { editingSettingsParts, slashItems } from '../registries';
import type { SlashItemDef } from '../registries';
import type { SlashSession } from '../../../editor/extensions/slash';
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

const OUTLINE: readonly [PageCommandId, MessageKey][] = [
  ['outline.moveUp', 'editor.commands.moveUp'],
  ['outline.moveDown', 'editor.commands.moveDown'],
  ['outline.promote', 'editor.commands.promote'],
  ['outline.demote', 'editor.commands.demote'],
  ['outline.fold', 'editor.commands.fold'],
  ['outline.unfold', 'editor.commands.unfold'],
  ['outline.showAll', 'editor.commands.showAll'],
];
for (const [id, title] of OUTLINE) {
  const keywords: MessageKey =
    id.includes('fold') || id === 'outline.showAll' ? 'editor.keywords.fold' : 'editor.keywords.outline';
  register({ id, title, keywords, category: 'editing', flag: 'page.outline' });
}
for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
  register({
    id: `outline.showLevel${level}`,
    title: `editor.commands.showLevel${level}`,
    keywords: 'editor.keywords.fold',
    category: 'view',
    flag: 'page.outline',
  });
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
  bar({ group: 'paragraph', command: 'outline.promote', priority: 37, flag: 'page.outline' }),
  bar({ group: 'paragraph', command: 'outline.demote', priority: 37, flag: 'page.outline' }),
  bar({ group: 'paragraph', command: 'block.toggleCheck', priority: 38 }),
  bar({ group: 'styles', command: 'block.normal', priority: 50, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.heading1', priority: 49, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.heading2', priority: 48, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.heading3', priority: 47, presentation: 'toggle' }),
  bar({ group: 'styles', command: 'block.turnInto', priority: 25, flag: 'page.slashMenu' }),
  bar({ tab: 'view', group: 'outline', command: 'outline.showAll', priority: 20, flag: 'page.outline' }),
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

// The slash menu's items. Headings 4 to 6 show once the filter asks for them; Table and Image show when their
// packages register their commands.
type SlashSpec = readonly [
  name: string,
  group: SlashItemDef['group'],
  order: number,
  command: CommandId,
  flag?: FlagId,
];
const SLASH: readonly SlashSpec[] = [
  ['normal', 'basic', 10, 'block.normal'],
  ['heading1', 'basic', 21, 'block.heading1'],
  ['heading2', 'basic', 22, 'block.heading2'],
  ['heading3', 'basic', 23, 'block.heading3'],
  ['heading4', 'basic', 24, 'block.heading4'],
  ['heading5', 'basic', 25, 'block.heading5'],
  ['heading6', 'basic', 26, 'block.heading6'],
  ['quote', 'basic', 40, 'block.quote'],
  ['callout', 'basic', 41, 'block.callout'],
  ['divider', 'basic', 50, 'block.divider'],
  ['bulletList', 'lists', 10, 'block.bulletList'],
  ['orderedList', 'lists', 11, 'block.orderedList'],
  ['checklist', 'lists', 12, 'block.checklist'],
  ['table', 'media', 10, 'insert.table', 'page.tables'],
  ['image', 'media', 20, 'insert.image', 'page.images'],
  ['codeBlock', 'advanced', 10, 'block.codeBlock'],
  ['date', 'advanced', 20, 'insert.date', 'page.typingHelpers'],
  ['time', 'advanced', 21, 'insert.time', 'page.typingHelpers'],
  ['dateTime', 'advanced', 22, 'insert.dateTime', 'page.typingHelpers'],
];
const SLASH_KEYWORDS: Record<string, MessageKey> = { normal: 'editor.slash.keywords.text' };
const SLASH_TITLES: Record<string, MessageKey> = {
  table: 'editor.slash.table',
  image: 'editor.slash.image',
};
for (const [name, group, order, command, flag] of SLASH) {
  const heading = name.startsWith('heading');
  slashItems.register({
    id: `editor.${name}`,
    title: SLASH_TITLES[name] ?? (`editor.commands.${name}` as MessageKey),
    keywords:
      SLASH_KEYWORDS[name] ??
      (heading ? 'editor.slash.keywords.heading' : (`editor.slash.keywords.${name}` as MessageKey)),
    icon: '',
    group,
    order,
    command,
    flag: flag ?? 'page.slashMenu',
  });
}

// "/" at the start of a line opens a session; the page's menu attaches to it.
if (typeof document !== 'undefined') {
  document.addEventListener(SLASH_MENU_EVENT, (event) => {
    const session = (event as CustomEvent<SlashSession>).detail;
    void import('../slash/slashMenu').then(({ openSlashMenu }) => openSlashMenu(session));
  });
}

// Folds live in pageViews: editors ask for their block's folds as they mount, and report changes.
if (typeof document !== 'undefined') {
  const folds = () => import('../formattingBar/folds');
  document.addEventListener(FOLDS_REQUEST_EVENT, (event) => {
    const { detail } = event as CustomEvent<FoldsRequestDetail>;
    void folds().then(({ provideFolds }) => provideFolds(detail));
  });
  document.addEventListener(FOLDS_EVENT, (event) => {
    const { detail } = event as CustomEvent<FoldsDetail>;
    void folds().then(({ saveFolds }) => saveFolds(detail));
  });
}

// A new page gets the date and time under its title, and Settings, then Editing, gets WP4's two parts.
pageCreated.register({
  id: 'editor.dateLine',
  order: 10,
  run: async (pageId) => (await import('../formattingBar/dateLine')).addDateLine(pageId),
});
editingSettingsParts.register({
  id: 'editor.typing',
  title: 'editor.general.title',
  order: 10,
  flag: 'page.editor',
  load: () => import('../settings/EditingGeneral'),
});
editingSettingsParts.register({
  id: 'editor.autocorrect',
  title: 'editor.autocorrect.title',
  order: 20,
  flag: 'page.typingHelpers',
  load: () => import('../settings/EditingAutoCorrect'),
});

// Text styles: the dialog, and the shown notebook's styles as variables on the document.
commands.register(
  defineCommand({
    id: 'styles.edit',
    title: 'editor.commands.textStyles',
    keywords: 'editor.keywords.block',
    category: 'format',
    flag: 'page.styles',
    run: async (ctx) => {
      const notebook = ctx.target?.kind === 'node' ? ctx.target.id : undefined;
      await (await import('../styles/TextStylesDialog')).openTextStyles(notebook);
    },
  }),
);
commandBar.register({
  id: 'editor.styles.edit',
  tab: 'home',
  group: 'styles',
  command: 'styles.edit',
  priority: 24,
  flag: 'page.styles',
});
contextMenus.register({
  id: 'editor.styles.notebook',
  menu: 'tree.notebook',
  command: 'styles.edit',
  group: 'styles',
  order: 50,
  flag: 'page.styles',
});
onNavigate(() => {
  if (!isEnabled('page.styles') || shownNotebookId() === null) return;
  void import('../styles/store').then(({ applyShownStyles, installNotebookStyles }) => {
    installNotebookStyles();
    applyShownStyles();
  });
});

function shownNotebookId(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.notebookId : null;
}

// The formatting bar follows touch and pen selections in text boxes, or every selection with the setting at Always.
if (typeof document !== 'undefined') {
  let pointer = 'mouse';
  let timer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('pointerdown', (event) => void (pointer = event.pointerType), true);
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void showBarForSelection(pointer), 250);
  });
}

async function showBarForSelection(pointer: string): Promise<void> {
  const setting = getSettings().editing.formattingBar;
  if (setting === 'never' || !isEnabled('page.formattingBar')) return;
  if (setting === 'touchAndPen' && pointer !== 'touch' && pointer !== 'pen') return;
  const selection = document.getSelection();
  const inEditor = selection?.anchorNode?.parentElement?.closest('[data-scope~="editor"]');
  const bar = await import('../formattingBar/bar');
  if (!selection || selection.isCollapsed || !selection.rangeCount || !inEditor) {
    bar.closeFormattingBar();
    return;
  }
  bar.showFormattingBar(selection.getRangeAt(0).getBoundingClientRect());
}
