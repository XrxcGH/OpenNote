// The Data menu on a smart table's strip and the options menu on a chart (Phase 7). Menus list what the table can
// do for the column with the caret; the same actions are palette commands (commands.ts).
import { t } from '../../../strings/t';
import type { MenuItemSpec } from '../../../ui';
import type { ChartKind, ColumnType, TotalKind } from '../engine';
import { isEnabled } from '../../../app/flags';
import { addChart, changeChart, clearCalculated, fill, filterBy, setFormat, setTotal, sortColumn } from './ops';
import { calculatedColumn } from './calculated';
import { unitItems } from './units';
import { choiceOf } from './choice';
import { chooseValue, editChoices, filterByChoice, makeChoice } from './choiceOps';
import {
  applyView,
  deleteView,
  matchesView,
  renameViewAsking,
  saveViewAsking,
  savedViewsOf,
  updateView,
} from './savedViews';
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

/** The choice settings of the column with the caret, when it is one and choice columns are on. */
function choiceHere({ inst, column }: Ctx) {
  const id = inst.model().columnIds[column];
  return isEnabled('tables.choice') && id !== undefined ? choiceOf(inst.smart(), id) : null;
}

function filterItem(ctx: Ctx): MenuItemSpec {
  const { inst, inBody, column } = ctx;
  const choice = choiceHere(ctx);
  return {
    id: 'filter',
    label: t('smart.table.filter'),
    separatorBefore: true,
    submenu: [
      ...(choice?.options ?? []).map((option, index): MenuItemSpec => ({
        id: `filterChoice-${index}`,
        label: t('smart.choice.filterOnly', { name: option.name }),
        onSelect: run(() => filterByChoice(inst, column, option.name)),
      })),
      {
        id: 'filterEqual',
        label: t('smart.table.filterEqual'),
        separatorBefore: choice !== null && choice.options.length > 0,
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

function savedViewsItem({ inst }: Ctx): MenuItemSpec {
  const smart = inst.smart();
  const views = savedViewsOf(smart);
  const active = views.find((one) => one.id === smart.savedActive);
  return {
    id: 'savedViews',
    label: t('smart.saved.menu'),
    submenu: [
      {
        id: 'savedAll',
        label: t('smart.saved.showAll'),
        kind: 'radio',
        checked: active === undefined && smart.filters.length === 0,
        onSelect: run(() => applyView(inst, null)),
      },
      ...views.map((one): MenuItemSpec => ({
        id: `saved-${one.id}`,
        label: one.name,
        kind: 'radio',
        checked: one.id === active?.id,
        onSelect: run(() => applyView(inst, one.id)),
      })),
      {
        id: 'savedSave',
        label: t('smart.saved.save'),
        separatorBefore: true,
        onSelect: run(() => saveViewAsking(inst)),
      },
      ...(active
        ? [
            {
              id: 'savedUpdate',
              label: t('smart.saved.update', { name: active.name }),
              disabled: matchesView(smart, active),
              onSelect: run(() => updateView(inst, active.id)),
            },
            {
              id: 'savedRename',
              label: t('smart.saved.rename'),
              onSelect: run(() => renameViewAsking(inst, active.id)),
            },
            { id: 'savedDelete', label: t('smart.saved.delete'), onSelect: run(() => deleteView(inst, active.id)) },
          ]
        : []),
    ],
  };
}

function formatItem(ctx: Ctx): MenuItemSpec {
  const { inst, column, own } = ctx;
  const choices = isEnabled('tables.choice');
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
      ...(choices
        ? [
            {
              id: 'format-choiceOne',
              label: t('smart.choice.formatOne'),
              kind: 'radio' as const,
              checked: own.type === 'choice' && own.multi !== true,
              onSelect: run(() => makeChoice(inst, column, false)),
            },
            {
              id: 'format-choiceMany',
              label: t('smart.choice.formatMany'),
              kind: 'radio' as const,
              checked: own.type === 'choice' && own.multi === true,
              onSelect: run(() => makeChoice(inst, column, true)),
            },
          ]
        : []),
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
      ...unitItems(inst, column, own),
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
    ...(choiceHere(ctx)
      ? [
          {
            id: 'chooseValue',
            label: t('smart.choice.choose'),
            shortcut: 'Alt+Down',
            disabled: !inBody,
            separatorBefore: true,
            onSelect: run(() => chooseValue(inst, column)),
          },
          { id: 'editChoices', label: t('smart.choice.edit'), onSelect: run(() => editChoices(inst, column)) },
        ]
      : []),
    ...(isEnabled('tables.savedViews') ? [savedViewsItem(ctx)] : []),
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
