// The Layout tab's registrations (text program, B12): page and column breaks, columns, vertical text, line numbers,
// and the header and footer dialog. The break block's renderer registers here too. This file loads at start-up, so it
// holds only definitions; each command loads its code when first run. Everything sits behind text.layout.
import { executeCommand } from '../../../commands/registry';
import type { CommandContext, CommandId } from '../../../commands/types';
import { REMOVE_BREAK_EVENT, type RemoveBreakDetail } from '../../../editor/commands/state';
import { inTaskItem } from '../../../editor/commands/state';
import { commandBar, commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { pageCommandDef, type PageCommandId } from '../keys';
import { blockRenderers, slashItems } from '../registries';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync';
import { breakBlockRenderer } from '../textLayout/breakBlock';

const FLAG = 'text.layout' as const;

blockRenderers.register(breakBlockRenderer);

// Backspace at the start of the text after a break removes the break.
if (typeof document !== 'undefined') {
  document.addEventListener(REMOVE_BREAK_EVENT, (event) => {
    const { detail } = event as CustomEvent<RemoveBreakDetail>;
    void import('../textLayout/removeBreak').then(({ removeBreak }) => removeBreak(detail));
  });
}

const load = () => import('../textLayout/commands');
const loadBreak = () => import('../textLayout/insertBreak');

const haveText = () => targetEditor() !== null;
/** A break splits the block with the caret, so a locked block turns the commands off. */
const unlocked = () => {
  const active = shownPool.get()?.active();
  return !(active && shownLayer.get()?.block(active.block)?.lock);
};
const havePage = () => shownQueue.get() !== null;
/** Ctrl+Enter is Check or uncheck inside a task item, so the key press there runs that command instead. */
const inTask = () => {
  const editor = targetEditor();
  return editor !== null && inTaskItem(editor.state);
};
const keyInTask = (ctx: CommandContext) => ctx.source === 'keyboard' && inTask();

interface Def {
  readonly id: PageCommandId;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly when: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => unknown;
}

const DEFS: readonly Def[] = [
  {
    id: 'insert.pageBreak',
    title: 'textLayout.commands.pageBreak',
    keywords: 'textLayout.commands.pageBreakKeywords',
    when: (ctx) => ((havePage() && !inTask()) || keyInTask(ctx)) && unlocked(),
    run: async (ctx) => {
      if (keyInTask(ctx)) {
        await executeCommand('block.toggleCheck', undefined, 'keyboard');
        return;
      }
      if (await (await loadBreak()).insertBreak('page')) announce(t('textLayout.announce.pageBreak'));
    },
  },
  {
    id: 'insert.columnBreak',
    title: 'textLayout.commands.columnBreak',
    keywords: 'textLayout.commands.columnBreakKeywords',
    when: () => havePage() && unlocked(),
    run: async () => {
      if (await (await loadBreak()).insertBreak('column')) announce(t('textLayout.announce.columnBreak'));
    },
  },
  {
    id: 'layout.columns1',
    title: 'textLayout.commands.columns1',
    keywords: 'textLayout.commands.columnsKeywords',
    when: haveText,
    run: async () => (await load()).setColumns(1),
  },
  {
    id: 'layout.columns2',
    title: 'textLayout.commands.columns2',
    keywords: 'textLayout.commands.columnsKeywords',
    when: haveText,
    run: async () => (await load()).setColumns(2),
  },
  {
    id: 'layout.columns3',
    title: 'textLayout.commands.columns3',
    keywords: 'textLayout.commands.columnsKeywords',
    when: haveText,
    run: async () => (await load()).setColumns(3),
  },
  {
    id: 'layout.columns4',
    title: 'textLayout.commands.columns4',
    keywords: 'textLayout.commands.columnsKeywords',
    when: haveText,
    run: async () => (await load()).setColumns(4),
  },
  {
    id: 'layout.verticalText',
    title: 'textLayout.commands.verticalText',
    keywords: 'textLayout.commands.verticalTextKeywords',
    when: haveText,
    run: async () => (await load()).toggleVertical(),
  },
  {
    id: 'layout.lineNumbers',
    title: 'textLayout.commands.lineNumbers',
    keywords: 'textLayout.commands.lineNumbersKeywords',
    when: havePage,
    run: async () => (await load()).toggleLineNumbers(),
  },
  {
    id: 'layout.headerFooter',
    title: 'textLayout.commands.headerFooter',
    keywords: 'textLayout.commands.headerFooterKeywords',
    when: havePage,
    run: async () => (await load()).openHeaderFooter(),
  },
];

for (const def of DEFS) {
  commands.register(
    pageCommandDef({
      id: def.id,
      title: def.title,
      keywords: def.keywords,
      category: 'insert',
      flag: FLAG,
      when: def.when,
      run: (ctx) => void def.run(ctx),
    }),
  );
}

const ITEMS: readonly (readonly [PageCommandId, 'insert' | 'layout', string, number])[] = [
  ['insert.pageBreak', 'insert', 'pageBreak', 10],
  ['insert.columnBreak', 'insert', 'columnBreak', 10],
  ['insert.pageBreak', 'layout', 'breaks', 20],
  ['insert.columnBreak', 'layout', 'breaks', 19],
  ['layout.columns1', 'layout', 'columns', 30],
  ['layout.columns2', 'layout', 'columns', 29],
  ['layout.columns3', 'layout', 'columns', 28],
  ['layout.columns4', 'layout', 'columns', 27],
  ['layout.verticalText', 'layout', 'columns', 20],
  ['layout.lineNumbers', 'layout', 'pageSetup', 20],
  ['layout.headerFooter', 'layout', 'pageSetup', 19],
];
for (const [command, tab, group, priority] of ITEMS) {
  commandBar.register({ id: `${tab}.${command}`, tab, group, command, priority, flag: FLAG });
}

slashItems.register({
  id: 'pageBreak',
  title: 'textLayout.commands.pageBreak',
  keywords: 'textLayout.commands.pageBreakKeywords',
  icon: 'Scissors',
  group: 'advanced',
  order: 20,
  flag: FLAG,
  command: 'insert.pageBreak' satisfies CommandId,
});
