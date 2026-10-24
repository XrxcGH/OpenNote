// The expression-engine lane's registrations (Phases 7 and 10): equations, smart tables, charts, the grapher, and
// the study tool windows. This file loads at start-up, so it holds only definitions; each command loads its
// feature on first use.
import type { Editor } from '@tiptap/core';
import { chord } from '../../../commands/registry';
import { commandBar, commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import type { CommandCategory } from '../../../commands/types';
import { announce } from '../../../ui';
import type { IconName } from '../../../ui/icons';
import { INSERT_EVENT } from '../../tools/flags';
import { targetEditor } from '../formattingBar/target';
import { shownMedia } from '../images/shown';
import { slashItems } from '../registries';
import { currentTable } from '../tables/current';
import { tableExtras } from '../tables/extras';
import type { SlashItemDef } from '../registries';

const inEditor = () => targetEditor() !== null;

/** The text blocks of the shown page, last one last. */
const textBlocks = () =>
  shownMedia
    .get()
    ?.layer.blocks()
    .filter((block) => block.type === 'text') ?? [];

/**
 * The editor an equation or a graph goes in: the one with the caret, or else the end of the page's last text block, so
 * the Insert tab offers them before the page is clicked into, as it does a table (Beta 5 walk W2-17).
 */
export function insertTarget(): Editor | null {
  const editor = targetEditor();
  if (editor) return editor;
  const last = textBlocks().at(-1);
  const pool = shownMedia.get()?.pool;
  return last && pool ? pool.mount(last.id, { kind: 'end' }, 'target') : null;
}
export const canInsert = () => inEditor() || textBlocks().length > 0;

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
  /** When it is offered; in an editor unless given. */
  when?: () => boolean;
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
    when: spec.when ?? inEditor,
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
  const editor = insertTarget();
  if (!editor) return;
  const { insertMath } = await import('../../math');
  if (insertMath(editor, display)) announce(t('smart.math.announceInserted'));
}

async function mathAction(kind: 'simplify' | 'solve'): Promise<void> {
  const editor = targetEditor();
  if (!editor) return;
  const { runMathAction } = await import('../../../editor/extensions/math');
  if (!runMathAction(editor, kind)) announce(t('smart.math.noEquation'));
}

add({
  id: 'math.simplify',
  title: 'smart.math.simplify',
  keywords: 'smart.math.keywords',
  icon: 'MathOperations',
  flag: 'math.latex',
  run: () => mathAction('simplify'),
});
add({
  id: 'math.solve',
  title: 'smart.math.solve',
  keywords: 'smart.math.keywords',
  icon: 'MathOperations',
  flag: 'math.latex',
  run: () => mathAction('solve'),
});

add({
  id: 'insert.graph',
  title: 'smart.grapher.insert',
  keywords: 'smart.grapher.insertKeywords',
  icon: 'ChartLine',
  flag: 'math.grapher',
  slash: { group: 'advanced', order: 22 },
  bar: { group: 'math', priority: 38 },
  when: canInsert,
  run: async () => {
    const editor = insertTarget();
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
  when: canInsert,
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
  flag?: 'tables.smart' | 'tables.charts' | 'tables.savedViews' | 'tables.choice' | 'tables.analysis';
  keys?: readonly string[];
  command: import('../../tables').SmartCommand;
}

const TABLE_COMMANDS: TableSpec[] = [
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
  {
    id: 'table.saveView',
    title: 'smart.saved.commandSave',
    icon: 'Funnel',
    flag: 'tables.savedViews',
    command: { run: 'saveView' },
  },
  {
    id: 'table.showAllRows',
    title: 'smart.saved.commandAll',
    icon: 'FunnelX',
    flag: 'tables.savedViews',
    command: { run: 'showAllRows' },
  },
  {
    id: 'table.formatChoice',
    title: 'smart.choice.formatOne',
    icon: 'ListChecks',
    flag: 'tables.choice',
    command: { run: 'choice', multi: false },
  },
  {
    id: 'table.formatChoices',
    title: 'smart.choice.formatMany',
    icon: 'ListChecks',
    flag: 'tables.choice',
    command: { run: 'choice', multi: true },
  },
  {
    id: 'table.chooseValue',
    title: 'smart.choice.choose',
    icon: 'ListChecks',
    flag: 'tables.choice',
    keys: ['Alt+Down'],
    command: { run: 'chooseValue' },
  },
  {
    id: 'table.editChoices',
    title: 'smart.choice.edit',
    icon: 'ListChecks',
    flag: 'tables.choice',
    command: { run: 'editChoices' },
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

const ANALYSIS_COMMANDS = [
  'summary',
  'histogram',
  'boxPlot',
  'linear',
  'quadratic',
  'cubic',
  'polynomial',
  'exponential',
  'determinant',
  'inverse',
  'transpose',
  'multiply',
  'rref',
  'rank',
  'eigenvalues',
  'solve',
] as const;

for (const tool of ANALYSIS_COMMANDS) {
  TABLE_COMMANDS.push({
    id: `table.analyze${tool[0].toUpperCase()}${tool.slice(1)}`,
    title: `tableMath.commands.${tool}`,
    icon: tool === 'summary' || tool === 'histogram' || tool === 'boxPlot' ? 'ChartBar' : 'Sigma',
    flag: 'tables.analysis',
    command: { run: 'analyze', tool },
  });
}

for (const tool of [
  'linear',
  'quadratic',
  'cubic',
  'exponential',
  'determinant',
  'inverse',
  'transpose',
  'rref',
  'rank',
  'eigenvalues',
  'solve',
] as const) {
  TABLE_COMMANDS.push({
    id: `table.analyze${tool[0].toUpperCase()}${tool.slice(1)}Equation`,
    title: `tableMath.commands.${tool}Equation`,
    icon: 'Sigma',
    flag: 'tables.analysis',
    command: { run: 'analyze', tool, output: 'equation' },
  });
}

for (const spec of TABLE_COMMANDS) {
  const inTable = spec.id.startsWith('table.');
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.id.startsWith('insert.')
      ? 'smart.chart.insertKeywords'
      : spec.id.startsWith('table.analyze')
        ? 'tableMath.keywords'
        : 'smart.table.keywords',
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
for (const [tool, title, icon, keywords] of [
  ['timers', 'smart.tools.openTimers', 'Timer', 'smart.tools.keywords'],
  ['calculator', 'smart.tools.openCalculator', 'Calculator', 'smart.tools.keywords'],
  ['upcoming', 'smart.tools.openUpcoming', 'CalendarCheck', 'smart.tools.upcomingKeywords'],
] as const) {
  commands.register({
    id: `tools.${tool}`,
    title,
    keywords,
    category: 'general',
    icon,
    flag: 'tools.windows',
    run: async () => (await import('../../tools')).openTool(tool),
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener(INSERT_EVENT, (event) => {
    const detail = (
      event as CustomEvent<{
        text?: string;
        graph?: string;
        table?: { header: string[]; rows: string[][] };
        math?: { source: string; display: boolean };
        picture?: { bytes: ArrayBuffer; name: string; alt: string; mime: string };
        handled: boolean;
      }>
    ).detail;
    if (detail?.picture) {
      // A picture goes on the page as an image block, where the page puts new images.
      const picture = detail.picture;
      detail.handled = true;
      void Promise.all([import('../images/insert'), import('../images/shown')]).then(([insert, shown]) => {
        const mounted = shown.shownMedia.get();
        if (mounted && !mounted.page.readOnly) void insert.insertImages(mounted, [{ kind: 'bytes', ...picture }]);
      });
      return;
    }
    const editor = targetEditor();
    if (!detail || !editor) return;
    if (detail.table !== undefined) {
      // Answered at once like a graph; the table is built and added when its code arrives.
      const { header, rows } = detail.table;
      detail.handled = true;
      void Promise.all([import('../tables/insert'), import('../../../editor/table/mapping')]).then(
        ([insert, mapping]) => {
          const data = mapping.newTableData(header.length, rows.length + 1, true);
          [header, ...rows].forEach((line, r) =>
            line.forEach((text, c) => {
              data.rows[r].cells[data.columns[c].id] = { markdown: text };
            }),
          );
          return insert.insertTable(data);
        },
      );
    } else if (detail.text !== undefined) {
      // A double-click selects the word and the space after it. The text replaces the word, and the space stays.
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, ' ', ' ');
      const lead = selected.length - selected.trimStart().length;
      const trail = selected.length - selected.trimEnd().length;
      const range = selected.trim() === '' ? { from, to } : { from: from + lead, to: to - trail };
      detail.handled = editor.chain().focus().insertContentAt(range, detail.text).run();
    } else if (detail.math !== undefined) {
      const { source, display } = detail.math;
      const type = editor.schema.nodes[display ? 'mathBlock' : 'mathInline'];
      if (type && source.trim() !== '') {
        detail.handled = editor
          .chain()
          .focus()
          .insertContent({ type: type.name, attrs: { source: source.trim() } })
          .run();
      }
    } else if (detail.graph !== undefined) {
      // The listener must answer at once, so a graph is claimed now and added when its code arrives.
      detail.handled = true;
      void import('../../../editor/extensions/graphFence').then(({ insertGraph }) => insertGraph(editor, detail.graph));
    }
  });
}
