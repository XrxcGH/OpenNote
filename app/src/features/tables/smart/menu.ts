// The Data menu on a smart table's strip and the options menu on a chart (Phase 7). Menus list what the table can
// do for the column with the caret; the same actions are palette commands (commands.ts).
import { t } from '../../../strings/t';
import type { MenuItemSpec } from '../../../ui';
import type { ChartKind, ColumnType, TotalKind } from '../engine';
import { isEnabled } from '../../../app/flags';
import { addChart, changeChart, clearCalculated, fill, filterBy, setFormat, setTotal, sortColumn } from './ops';
import { calculatedColumn } from './calculated';
import type { ColumnSmart } from './data';
import type { SmartInstance } from './ops';

const FORMATS: readonly { type: ColumnType; label: Parameters<typeof t>[0] }[] = [
  { type: 'number', label: 'smart.table.formats.number' },
  { type: 'currency', label: 'smart.table.formats.currency' },
  { type: 'percent', label: 'smart.table.formats.percent' },
  { type: 'date', label: 'smart.table.formats.date' },
  { type: 'text', label: 'smart.table.formats.text' },
];

const TOTALS: readonly { total: TotalKind; label: Parameters<typeof t>[0] }[] = [
  { total: 'sum', label: 'smart.table.totalKinds.sum' },
  { total: 'average', label: 'smart.table.totalKinds.average' },
  { total: 'count', label: 'smart.table.totalKinds.count' },
  { total: 'min', label: 'smart.table.totalKinds.min' },
  { total: 'max', label: 'smart.table.totalKinds.max' },
];

export const CHART_KINDS: readonly { kind: ChartKind; label: Parameters<typeof t>[0] }[] = [
  { kind: 'bar', label: 'smart.chart.kinds.bar' },
  { kind: 'line', label: 'smart.chart.kinds.line' },
  { kind: 'area', label: 'smart.chart.kinds.area' },
  { kind: 'pie', label: 'smart.chart.kinds.pie' },
  { kind: 'scatter', label: 'smart.chart.kinds.scatter' },
];

const run = (work: () => Promise<unknown>) => () => void work();

interface Ctx {
  inst: SmartInstance;
  column: number;
  own: ColumnSmart;
  inBody: boolean;
}

function filterItem({ inst, inBody }: Ctx): MenuItemSpec {
  return {
    id: 'filter',
    label: t('smart.table.filter'),
    separatorBefore: true,
    submenu: [
      {
        id: 'filterEqual',
        label: t('smart.table.filterEqual'),
        disabled: !inBody,
        onSelect: run(() => filterBy(inst, 'equal')),
      },
      {
        id: 'filterNotEmpty',
        label: t('smart.table.filterNotEmpty'),
        disabled: !inBody,
        onSelect: run(() => filterBy(inst, 'notEmpty')),
      },
      {
        id: 'filterGreater',
        label: t('smart.table.filterGreater'),
        disabled: !inBody,
        onSelect: run(() => filterBy(inst, 'greater')),
      },
      {
        id: 'filterLess',
        label: t('smart.table.filterLess'),
        disabled: !inBody,
        onSelect: run(() => filterBy(inst, 'less')),
      },
      {
        id: 'filterClear',
        label: t('smart.table.clearFilter'),
        separatorBefore: true,
        disabled: inst.smart().filters.length === 0,
        onSelect: run(() => filterBy(inst, 'clear')),
      },
    ],
  };
}

function formatItem({ inst, column, own }: Ctx): MenuItemSpec {
  return {
    id: 'format',
    label: t('smart.table.format'),
    submenu: [
      {
        id: 'formatAuto',
        label: t('smart.table.formats.automatic'),
        kind: 'radio',
        checked: own.type === undefined,
        onSelect: run(() => setFormat(inst, column, { type: null })),
      },
      ...FORMATS.map(({ type, label }): MenuItemSpec => ({
        id: `format-${type}`,
        label: t(label),
        kind: 'radio',
        checked: own.type === type,
        onSelect: run(() => setFormat(inst, column, { type })),
      })),
      {
        id: 'moreDecimals',
        label: t('smart.table.moreDecimals'),
        separatorBefore: true,
        onSelect: run(() => setFormat(inst, column, { moreDecimals: 1 })),
      },
      {
        id: 'fewerDecimals',
        label: t('smart.table.fewerDecimals'),
        onSelect: run(() => setFormat(inst, column, { moreDecimals: -1 })),
      },
    ],
  };
}

function totalItem({ inst, column, own }: Ctx): MenuItemSpec {
  return {
    id: 'total',
    label: t('smart.table.total'),
    submenu: [
      {
        id: 'totalNone',
        label: t('smart.table.totalNone'),
        kind: 'radio',
        checked: own.total === undefined,
        onSelect: run(() => setTotal(inst, column, null)),
      },
      ...TOTALS.map(({ total, label }): MenuItemSpec => ({
        id: `total-${total}`,
        label: t(label),
        kind: 'radio',
        checked: own.total === total,
        onSelect: run(() => setTotal(inst, column, total)),
      })),
    ],
  };
}

export function dataMenu(inst: SmartInstance): MenuItemSpec[] {
  const model = inst.model();
  const caret = inst.caret();
  const column = Math.min(caret?.column ?? 0, model.columnIds.length - 1);
  const own = inst.smart().columns[model.columnIds[column]] ?? {};
  const inBody = caret !== null && caret.row >= model.offset;
  const ctx: Ctx = { inst, column, own, inBody };
  return [
    {
      id: 'sortAscending',
      label: t('smart.table.sortAscending'),
      onSelect: run(() => sortColumn(inst, column, false)),
    },
    {
      id: 'sortDescending',
      label: t('smart.table.sortDescending'),
      onSelect: run(() => sortColumn(inst, column, true)),
    },
    filterItem(ctx),
    formatItem(ctx),
    totalItem(ctx),
    ...(isEnabled('tables.calculated')
      ? [
          {
            id: 'calculated',
            label: t('smart.calculated.menu'),
            separatorBefore: true,
            onSelect: run(() => calculatedColumn(inst, column)),
          },
          {
            id: 'clearCalculated',
            label: t('smart.calculated.clear'),
            onSelect: run(() => clearCalculated(inst, column)),
          },
        ]
      : []),
    {
      id: 'fillDown',
      label: t('smart.table.fillDown'),
      separatorBefore: !isEnabled('tables.calculated'),
      onSelect: run(() => fill(inst, 'down')),
    },
    { id: 'fillRight', label: t('smart.table.fillRight'), onSelect: run(() => fill(inst, 'right')) },
    {
      id: 'chart',
      label: t('smart.chart.insert'),
      separatorBefore: true,
      submenu: CHART_KINDS.map(({ kind, label }): MenuItemSpec => ({
        id: `chart-${kind}`,
        label: t(label),
        onSelect: run(() => addChart(inst, kind)),
      })),
    },
  ];
}

export function chartMenu(inst: SmartInstance, id: string): MenuItemSpec[] {
  const chart = inst.smart().charts.find((candidate) => candidate.id === id);
  return [
    ...CHART_KINDS.map(({ kind, label }): MenuItemSpec => ({
      id: `kind-${kind}`,
      label: t(label),
      kind: 'radio',
      checked: chart?.kind === kind,
      onSelect: () => void changeChart(inst, id, { kind }),
    })),
    {
      id: 'patterns',
      label: t('smart.chart.patterns'),
      kind: 'checkbox',
      checked: chart?.patterns === true,
      separatorBefore: true,
      onSelect: () => void changeChart(inst, id, { patterns: chart?.patterns !== true }),
    },
  ];
}
