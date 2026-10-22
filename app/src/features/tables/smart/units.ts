// Units in smart table columns (Engineering tools): the question that sets a column's unit, and the menu items for
// the unit and the notation. A unit makes the column a number column whose cells convert to it.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import type { MenuItemSpec } from '../../../ui';
import { parseUnit } from '../../../core/units';
import type { ColumnSmart } from './data';
import { setFormat } from './ops';
import type { SmartInstance } from './ops';
import { askText } from './prompt';

/** Asks for the column's unit. An empty answer removes it. */
export async function askUnit(inst: SmartInstance, column: number): Promise<boolean> {
  const id = inst.model().columnIds[column];
  const own = inst.smart().columns[id] ?? {};
  const unit = await askText({
    title: t('engineering.table.unitTitle'),
    description: t('engineering.table.unitDescription'),
    label: t('engineering.table.unitLabel'),
    help: t('engineering.table.unitHelp'),
    initial: own.unit ?? '',
    confirmLabel: t('engineering.table.unitSave'),
    check: (text) =>
      text.trim() === '' || parseUnit(text) ? null : t('engineering.table.unitUnknown', { unit: text.trim() }),
  });
  if (unit === null) return false;
  const trimmed = unit.trim();
  await setFormat(inst, column, { unit: trimmed === '' ? null : trimmed });
  inst.host.announce(
    trimmed === '' ? t('engineering.table.unitCleared') : t('engineering.table.unitSet', { unit: trimmed }),
  );
  return true;
}

const NOTATIONS = [
  { notation: null, label: 'engineering.table.notationPlain' },
  { notation: 'engineering', label: 'engineering.table.notationEngineering' },
  { notation: 'si', label: 'engineering.table.notationSi' },
] as const;

/** The unit and notation items of the Format menu, when units in tables are on. */
export function unitItems(inst: SmartInstance, column: number, own: ColumnSmart): MenuItemSpec[] {
  if (!isEnabled('tables.units')) return [];
  const run = (work: () => Promise<unknown>) => () => void work();
  return [
    {
      id: 'unit',
      label: own.unit ? t('engineering.table.unitNamed', { unit: own.unit }) : t('engineering.table.unit'),
      separatorBefore: true,
      onSelect: run(() => askUnit(inst, column)),
    },
    ...NOTATIONS.map(({ notation, label }): MenuItemSpec => ({
      id: `notation-${notation ?? 'plain'}`,
      label: t(label),
      kind: 'radio',
      checked: (own.notation ?? null) === notation,
      onSelect: run(() => setFormat(inst, column, { notation })),
    })),
  ];
}
