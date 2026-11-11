// The Home tab of the text program (Beta 10, text:home-tab-ui).
// It registers the formatting commands that take a choice: font, size, underline style, effects, case, list looks,
// line spacing, shading, and borders. It also registers the format painter and the Home groups with their overflow
// priorities. The page's context menu gets Font and Paragraph, and the compact class gets the Aa sheet.
// Every control sits behind text.v2Controls. With it off, the Home tab keeps its version 1 tools.
// This file loads at start-up, so it holds only definitions. The controls load when the bar draws them.
import { isEnabled } from '../../../app/flags';
import { defineCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import { runMarkPressed } from '../../../editor/commands/runFormat';
import { commandBar, commands, contextMenus } from '../../../registries';
import type { CommandBarItem } from '../../../registries/types';
import { bumpBar } from '../../../shell/commandbar/barTick';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { targetEditor } from '../formattingBar/target';
import { lazyTool } from '../homeTab/lazyTool';
import { formatKey } from '../homeTab/state';

const FLAG = 'text.v2Controls';

type Formatting = typeof import('../formattingBar/commands');
const formatting = (): Promise<Formatting> => import('../formattingBar/commands');

const name = (key: string): MessageKey => `textCommands.names.${key}` as MessageKey;

/** Catalog commands that take a choice. The bar's menus and boxes run them with the choice as the argument. */
const CHOICES: readonly (readonly [CommandId, MessageKey])[] = [
  ['format.font', name('font')],
  ['format.fontSize', name('fontSize')],
  ['format.weight', name('weight')],
  ['format.underlineStyle', name('underlineStyle')],
  ['format.effect', name('effect')],
  ['format.changeCase', name('changeCase')],
  ['list.bullet', name('bulletLibrary')],
  ['list.numberLook', name('numberLibrary')],
  ['list.multilevel', name('multilevel')],
  ['para.lineSpacing', name('lineSpacing')],
];
for (const [id, title] of CHOICES) {
  commands.register(
    defineCommand({
      id,
      title,
      category: 'format',
      flag: FLAG,
      palette: false,
      when: () => targetEditor() !== null,
      run: (_ctx, args) => formatting().then((m) => m.runFormatting(id, args as never)),
    }),
  );
}

/** Catalog commands that need no choice: they run from the bar, the palette, and the More menu. */
const PLAIN: readonly (readonly [CommandId, MessageKey])[] = [
  ['format.growFont', name('growFont')],
  ['format.shrinkFont', name('shrinkFont')],
  ['format.strikeDouble', name('strikeDouble')],
];
for (const [id, title] of PLAIN) {
  if (commands.get(id)) continue; // The shortcut lane registered it.
  commands.register(
    defineCommand({
      id,
      title,
      category: 'format',
      flag: FLAG,
      when: () => targetEditor() !== null,
      run: () => formatting().then((m) => m.runFormatting(id, undefined)),
    }),
  );
}

// The menu tools' own commands: shading and borders write a paragraph key, and need a choice from their menu.
for (const id of ['para.shade', 'para.border'] as const) {
  commands.register(
    defineCommand({
      id,
      title: name('paragraphFormat'),
      category: 'format',
      flag: FLAG,
      palette: false,
      when: () => targetEditor() !== null,
      run: () => undefined,
    }),
  );
}

// The format painter: one application, or locked until Escape.
for (const [id, title, locked] of [
  ['format.painter', name('painter'), false],
  ['format.painterLocked', name('painterLocked'), true],
] as const) {
  commands.register(
    defineCommand({
      id,
      title,
      category: 'format',
      flag: FLAG,
      when: () => targetEditor() !== null,
      run: async () => {
        const editor = targetEditor();
        if (!editor) return;
        const { startPainter } = await import('../../../editor/commands/painter');
        startPainter(editor, { locked });
      },
    }),
  );
}

// The Aa sheet and the context menu's two submenus.
commands.register(
  defineCommand({
    id: 'text.compactSheet',
    title: 'textHome.sheet.label',
    category: 'format',
    flag: FLAG,
    palette: false,
    when: () => targetEditor() !== null,
    run: async () => (await import('../homeTab/CompactSheet')).toggleCompactSheet(),
  }),
);
for (const [id, title, menu] of [
  ['text.contextFont', 'textHome.context.font', 'font'],
  ['text.contextParagraph', 'textHome.context.paragraph', 'paragraph'],
] as const) {
  commands.register(
    defineCommand({
      id,
      title,
      category: 'format',
      flag: FLAG,
      palette: false,
      when: () => targetEditor() !== null,
      run: async (ctx) => (await import('../homeTab/contextMenus')).openContextSubmenu(menu, ctx.target),
    }),
  );
}
contextMenus.register({
  id: 'text.ctx.font',
  menu: 'page.text',
  command: 'text.contextFont',
  group: 'format',
  order: 40,
  flag: FLAG,
});
contextMenus.register({
  id: 'text.ctx.paragraph',
  menu: 'page.text',
  command: 'text.contextParagraph',
  group: 'format',
  order: 50,
  flag: FLAG,
});

// What the bar shows can change without a store changing: the selection moves, or a key formats text.
// Typing moves the selection on every key, so the bar re-reads only when the formatting at the selection changed,
// and the check runs 100 ms after the last event, never in the keystroke's frame.
let lastKey: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
export const SELECTION_SETTLE_MS = 100;

function onSelectionActivity(): void {
  if (!isEnabled(FLAG)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const key = formatKey(targetEditor()?.state);
    if (key === lastKey) return;
    lastKey = key;
    bumpBar();
  }, SELECTION_SETTLE_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('selectionchange', onSelectionActivity);
  document.addEventListener('keyup', onSelectionActivity, true);
  document.addEventListener('pointerup', onSelectionActivity, true);
}

/** Whether only part of the selection has the mark, for the toggle's aria-pressed="mixed". */
const mixedMark = (mark: string) => () => {
  const editor = targetEditor();
  return editor !== null && runMarkPressed(editor.state, mark) === 'mixed';
};

const font = lazyTool(() => import('../homeTab/components').then((m) => m.FontBox), 136);
const size = lazyTool(() => import('../homeTab/components').then((m) => m.SizeControl), 60);
const underline = lazyTool(() => import('../homeTab/components').then((m) => m.UnderlineTool), 70);
const strike = lazyTool(() => import('../homeTab/components').then((m) => m.StrikeTool), 70);
const highlight = lazyTool(() => import('../homeTab/components').then((m) => m.HighlightTool), 70);
const textColor = lazyTool(() => import('../homeTab/components').then((m) => m.TextColorTool), 70);
const bullets = lazyTool(() => import('../homeTab/components').then((m) => m.BulletsTool), 70);
const numbering = lazyTool(() => import('../homeTab/components').then((m) => m.NumberingTool), 70);
const gallery = lazyTool(() => import('../homeTab/StylesGallery').then((m) => m.StylesGallery), 420);

/** A named menu tool (change case, effects, spacing, shading, borders), with the label its command gives. */
function menuTool(command: CommandId, label: MessageKey) {
  return lazyTool(() => import('../homeTab/components').then((m) => m.MenuTool), 110, { command, label: t(label) });
}

type Row = Omit<CommandBarItem, 'tab'>;
const home = (item: Row): CommandBarItem => ({ tab: 'home', ...item });
const component = (
  id: string,
  group: string,
  command: CommandId,
  priority: number,
  Component: CommandBarItem['Component'],
  more: Partial<Row> = {},
): CommandBarItem =>
  home({ id, group, command, priority, presentation: 'component', Component, flag: FLAG, overflow: [], ...more });
const old = (command: CommandId, group: string, priority: number, extra: Partial<Row> = {}): CommandBarItem =>
  home({ id: `editor.${command}`, group, command, priority, ...extra });

// Home, left to right. The font group is first, then the text, paragraph, and styles groups. A control of version 2
// replaces its version 1 tool (`offWith`), so no tool shows twice.
const toggle = (command: CommandId, group: string, priority: number, mark?: string, extra: Partial<Row> = {}) =>
  old(command, group, priority, { presentation: 'toggle', ...(mark ? { mixed: mixedMark(mark) } : {}), ...extra });

const HOME: readonly CommandBarItem[] = [
  component('home.font', 'font', 'format.font', 63, font),
  component('home.size', 'font', 'format.fontSize', 62, size),
  toggle('format.bold', 'text', 70, 'bold'),
  toggle('format.italic', 'text', 69, 'italic'),
  toggle('format.underline', 'text', 68, 'underline', { offWith: FLAG }),
  component('home.underline', 'text', 'format.underline', 68, underline, { overflow: ['format.underline'] }),
  toggle('format.strike', 'text', 40, 'strike', { offWith: FLAG }),
  component('home.strike', 'text', 'format.strike', 40, strike, { overflow: ['format.strike', 'format.strikeDouble'] }),
  toggle('format.subscript', 'text', 20, 'subscript'),
  toggle('format.superscript', 'text', 20, 'superscript'),
  component('home.effects', 'text', 'format.effect', 32, menuTool('format.effect', name('effect')), {
    overflow: ['format.smallCaps', 'format.allCaps'],
  }),
  toggle('format.highlight', 'text', 67, 'highlight', { offWith: FLAG }),
  component('home.highlight', 'text', 'format.highlight', 67, highlight, { overflow: ['format.highlight'] }),
  old('format.textColor', 'text', 45, { offWith: FLAG }),
  component('home.textColor', 'text', 'format.textColor', 61, textColor, { overflow: ['format.textColor'] }),
  home({ id: 'home.grow', group: 'text', command: 'format.growFont', priority: 36, flag: FLAG }),
  home({ id: 'home.shrink', group: 'text', command: 'format.shrinkFont', priority: 36, flag: FLAG }),
  component('home.case', 'text', 'format.changeCase', 31, menuTool('format.changeCase', name('changeCase')), {
    overflow: ['format.cycleCase'],
  }),
  home({ id: 'home.painter', group: 'text', command: 'format.painter', priority: 41, flag: FLAG }),
  old('format.textSize', 'text', 30, { offWith: FLAG }),
  old('format.clear', 'text', 35),
  toggle('block.bulletList', 'paragraph', 66, undefined, { offWith: FLAG }),
  component('home.bullets', 'paragraph', 'block.bulletList', 66, bullets, { overflow: ['block.bulletList'] }),
  toggle('block.orderedList', 'paragraph', 65, undefined, { offWith: FLAG }),
  component('home.numbering', 'paragraph', 'block.orderedList', 65, numbering, { overflow: ['block.orderedList'] }),
  toggle('block.checklist', 'paragraph', 64),
  component('home.multilevel', 'paragraph', 'list.multilevel', 29, menuTool('list.multilevel', name('multilevel')), {
    overflow: [],
  }),
  old('outline.promote', 'paragraph', 37, { flag: 'page.outline' }),
  old('outline.demote', 'paragraph', 37, { flag: 'page.outline' }),
  old('block.toggleCheck', 'paragraph', 38),
  home({ id: 'home.outdent', group: 'paragraph', command: 'para.outdent', priority: 38, flag: FLAG }),
  home({ id: 'home.indent', group: 'paragraph', command: 'para.indent', priority: 38, flag: FLAG }),
  home({ id: 'home.alignStart', group: 'paragraph', command: 'para.alignStart', priority: 44, flag: FLAG }),
  home({ id: 'home.alignCenter', group: 'paragraph', command: 'para.alignCenter', priority: 44, flag: FLAG }),
  home({ id: 'home.alignEnd', group: 'paragraph', command: 'para.alignEnd', priority: 43, flag: FLAG }),
  home({ id: 'home.justify', group: 'paragraph', command: 'para.justify', priority: 43, flag: FLAG }),
  component('home.spacing', 'paragraph', 'para.lineSpacing', 34, menuTool('para.lineSpacing', name('lineSpacing')), {
    overflow: ['para.lineSingle', 'para.line15', 'para.lineDouble'],
  }),
  component('home.shade', 'paragraph', 'para.shade', 28, menuTool('para.shade', 'textHome.shadingLabel'), {
    overflow: [],
  }),
  component('home.border', 'paragraph', 'para.border', 27, menuTool('para.border', 'textHome.bordersLabel'), {
    overflow: [],
  }),
  component('home.styles', 'styles', 'block.normal', 55, gallery, {
    overflow: ['block.normal', 'block.heading1', 'block.heading2', 'block.heading3'],
  }),
  toggle('block.normal', 'styles', 50, undefined, { offWith: FLAG }),
  toggle('block.heading1', 'styles', 49, undefined, { offWith: FLAG }),
  toggle('block.heading2', 'styles', 48, undefined, { offWith: FLAG }),
  toggle('block.heading3', 'styles', 47, undefined, { offWith: FLAG }),
  old('block.turnInto', 'styles', 25, { flag: 'page.slashMenu' }),
];
HOME.forEach((item) => commandBar.register(item));
