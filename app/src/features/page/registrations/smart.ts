// The expression-engine lane's registrations (Phases 7 and 10): equations, smart tables, charts, the grapher, and
// the study tool windows. This file loads at start-up, so it holds only definitions; each command loads its
// feature on first use.
import { chord } from '../../../commands/registry';
import { commandBar, commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import type { CommandCategory } from '../../../commands/types';
import { announce } from '../../../ui';
import type { IconName } from '../../../ui/icons';
import { INSERT_EVENT } from '../../tools/flags';
import { targetEditor } from '../formattingBar/target';
import { slashItems } from '../registries';
import { currentTable } from '../tables/current';
import { tableExtras } from '../tables/extras';
import type { SlashItemDef } from '../registries';

const inEditor = () => targetEditor() !== null;

interface Spec {
  id: `${string}.${string}`;
  title: MessageKey;
  keywords: MessageKey;
  icon: IconName;
  flag: 'math.latex' | 'math.grapher';
  category?: CommandCategory;
  keys?: readonly string[];
  slash?: Pick<SlashItemDef, 'group' | 'order'>;
  bar?: { group: string; priority: number };
  run(): void | Promise<void>;
}

function add(spec: Spec): void {
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.keywords,
    category: spec.category ?? 'insert',
    icon: spec.icon,
    flag: spec.flag,
    ...(spec.keys ? { keys: spec.keys.map(chord), scope: 'editor' as const, allowInTextInput: true } : {}),
    when: inEditor,
    run: spec.run,
  });
  if (spec.slash) {
    slashItems.register({
      id: spec.id,
      title: spec.title,
      keywords: spec.keywords,
      icon: spec.icon,
      flag: spec.flag,
      command: spec.id,
      ...spec.slash,
    });
  }
  if (spec.bar) commandBar.register({ id: spec.id, tab: 'insert', command: spec.id, flag: spec.flag, ...spec.bar });
}

async function insertEquation(display: boolean): Promise<void> {
  const editor = targetEditor();
  if (!editor) return;
  const { insertMath } = await import('../../math');
  if (insertMath(editor, display)) announce(t('smart.math.announceInserted'));
}

add({
  id: 'insert.graph',
  title: 'smart.grapher.insert',
  keywords: 'smart.grapher.insertKeywords',
  icon: 'ChartLine',
  flag: 'math.grapher',
  slash: { group: 'advanced', order: 22 },
  bar: { group: 'math', priority: 38 },
  run: async () => {
    const editor = targetEditor();
    if (!editor) return;
    // Loaded here, not at start-up: the editor's code is not needed until a graph is.
    const { insertGraph } = await import('../../../editor/extensions/graphFence');
    if (insertGraph(editor) !== null) announce(t('smart.grapher.announceInserted'));
  },
});
add({
  id: 'insert.equation',
  title: 'smart.math.insertBlock',
  keywords: 'smart.math.keywords',
  icon: 'MathOperations',
  flag: 'math.latex',
  slash: { group: 'advanced', order: 20 },
  bar: { group: 'math', priority: 40 },
  run: () => insertEquation(true),
});
add({
  id: 'insert.inlineMath',
  title: 'smart.math.insertInline',
  keywords: 'smart.math.keywords',
  icon: 'Function',
  flag: 'math.latex',
  keys: ['Alt+='],
  slash: { group: 'advanced', order: 21 },
  bar: { group: 'math', priority: 39 },
  run: () => insertEquation(false),
});

// Smart tables (Phase 7): the table block loads the smart extra when its editor mounts, and these commands act on
// the smart table that had focus last. The Data menu on the table's strip offers the same things.
tableExtras.register({
  id: 'smart',
  flag: 'tables.smart',
  attach: async (host) => (await import('../../tables')).attachSmart(host),
});

async function runSmart(command: import('../../tables').SmartCommand): Promise<void> {
  const { runSmartCommand } = await import('../../tables');
  await runSmartCommand(command);
}

interface TableSpec {
  id: `table.${string}` | `insert.${string}`;
  title: MessageKey;
  icon: IconName;
  flag?: 'tables.smart' | 'tables.charts';
  keys?: readonly string[];
  command: import('../../tables').SmartCommand;
}

const TABLE_COMMANDS: readonly TableSpec[] = [
  {
    id: 'table.sortAscending',
    title: 'smart.table.sortAscending',
    icon: 'SortAscending',
    command: { run: 'sort', desc: false },
  },
  {
    id: 'table.sortDescending',
    title: 'smart.table.sortDescending',
    icon: 'SortDescending',
    command: { run: 'sort', desc: true },
  },
  {
    id: 'table.fillDown',
    title: 'smart.table.fillDown',
    icon: 'ArrowLineDown',
    keys: ['Ctrl+D'],
    command: { run: 'fill', direction: 'down' },
  },
  {
    id: 'table.fillRight',
    title: 'smart.table.fillRight',
    icon: 'ArrowLineRight',
    keys: ['Ctrl+R'],
    command: { run: 'fill', direction: 'right' },
  },
  {
    id: 'table.filterEqual',
    title: 'smart.table.filterEqual',
    icon: 'Funnel',
    command: { run: 'filter', mode: 'equal' },
  },
  {
    id: 'table.filterNotEmpty',
    title: 'smart.table.filterNotEmpty',
    icon: 'Funnel',
    command: { run: 'filter', mode: 'notEmpty' },
  },
  {
    id: 'table.clearFilter',
    title: 'smart.table.clearFilter',
    icon: 'FunnelX',
    command: { run: 'filter', mode: 'clear' },
  },
  {
    id: 'table.formatAutomatic',
    title: 'smart.table.formats.automatic',
    icon: 'Hash',
    command: { run: 'format', type: null },
  },
  {
    id: 'table.formatNumber',
    title: 'smart.table.formats.number',
    icon: 'Hash',
    command: { run: 'format', type: 'number' },
  },
  {
    id: 'table.formatCurrency',
    title: 'smart.table.formats.currency',
    icon: 'CurrencyDollar',
    command: { run: 'format', type: 'currency' },
  },
  {
    id: 'table.formatPercent',
    title: 'smart.table.formats.percent',
    icon: 'Percent',
    command: { run: 'format', type: 'percent' },
  },
  {
    id: 'table.formatDate',
    title: 'smart.table.formats.date',
    icon: 'CalendarBlank',
    command: { run: 'format', type: 'date' },
  },
  { id: 'table.moreDecimals', title: 'smart.table.moreDecimals', icon: 'Plus', command: { run: 'decimals', by: 1 } },
  {
    id: 'table.fewerDecimals',
    title: 'smart.table.fewerDecimals',
    icon: 'Minus',
    command: { run: 'decimals', by: -1 },
  },
  { id: 'table.totalSum', title: 'smart.table.totalKinds.sum', icon: 'Sigma', command: { run: 'total', total: 'sum' } },
  { id: 'table.totalNone', title: 'smart.table.totalNone', icon: 'Sigma', command: { run: 'total', total: null } },
  ...(['bar', 'line', 'area', 'pie', 'scatter'] as const).map((kind): TableSpec => ({
    id: `insert.chart${kind[0].toUpperCase()}${kind.slice(1)}`,
    title: `smart.chart.kinds.${kind}`,
    icon: 'ChartBar',
    flag: 'tables.charts',
    command: { run: 'chart', kind },
  })),
];

for (const spec of TABLE_COMMANDS) {
  const inTable = spec.id.startsWith('table.');
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.id.startsWith('insert.') ? 'smart.chart.insertKeywords' : 'smart.table.keywords',
    category: inTable ? 'table' : 'insert',
    icon: spec.icon,
    flag: spec.flag ?? 'tables.smart',
    ...(spec.keys ? { keys: spec.keys.map(chord), scope: 'editor.table' as const, allowInTextInput: true } : {}),
    when: () => currentTable.get() !== null,
    run: () => runSmart(spec.command),
  });
}

// Tool windows (Phase 10): timers, the calculator, and Upcoming open from the palette. A tool can hand an answer or a
// graph to the page that is open, which takes it at the caret.
for (const [tool, title, icon] of [
  ['timers', 'smart.tools.openTimers', 'Timer'],
  ['calculator', 'smart.tools.openCalculator', 'Calculator'],
  ['upcoming', 'smart.tools.openUpcoming', 'CalendarCheck'],
] as const) {
  commands.register({
    id: `tools.${tool}`,
    title,
    keywords: 'smart.tools.keywords',
    category: 'general',
    icon,
    flag: 'tools.windows',
    run: async () => (await import('../../tools')).openTool(tool),
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener(INSERT_EVENT, (event) => {
    const detail = (event as CustomEvent<{ text?: string; graph?: string; handled: boolean }>).detail;
    const editor = targetEditor();
    if (!detail || !editor) return;
    if (detail.text !== undefined) detail.handled = editor.chain().focus().insertContent(detail.text).run();
    else if (detail.graph !== undefined) {
      // The listener must answer at once, so a graph is claimed now and added when its code arrives.
      detail.handled = true;
      void import('../../../editor/extensions/graphFence').then(({ insertGraph }) => insertGraph(editor, detail.graph));
    }
  });
}
