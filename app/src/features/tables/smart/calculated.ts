// The Calculated column dialog (Phase 7): asks for one formula and puts it in every row of the column with the caret.
import { t } from '../../../strings/t';
import { calculatedProblem, setCalculated } from './ops';
import type { SmartInstance } from './ops';
import { askText } from './prompt';

export async function calculatedColumn(inst: SmartInstance, column: number): Promise<boolean> {
  const name = inst.model().names[column] ?? '';
  const text = await askText({
    title: t('smart.calculated.title'),
    description: t('smart.calculated.description'),
    label: t('smart.calculated.label', { column: name }),
    confirmLabel: t('smart.calculated.confirm'),
    check: (typed) => calculatedProblem(typed, inst.locale, inst.model().names),
  });
  return text === null ? false : setCalculated(inst, column, text);
}
