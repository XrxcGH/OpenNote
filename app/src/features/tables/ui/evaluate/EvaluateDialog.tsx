// The Evaluate formula dialog: shows the active cell's formula with the part worked out next underlined, and works it
// out one step at a time (steps.ts) with the page's own engine, until the formula is one value.
import { useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Dialog } from '../../../../ui';
import type { DialogProps } from '../formulaBar/FormulaBar';
import { pageTables, evaluatorFor } from '../formulaBar/page';
import { gridAddress } from '../formulaBar/refs';
import styles from '../formulaBar/formulaBar.module.css';
import { evaluateStep, firstStep } from './steps';
import type { Step } from './steps';

export default function EvaluateDialog({ host, active, onClose }: DialogProps) {
  const formula = active?.text.startsWith('=') ? active.text.slice(1) : null;
  const start = useMemo(() => (formula === null ? null : firstStep(formula)), [formula]);
  const [step, setStep] = useState<Step | null>(start);
  const evaluate = useMemo(() => {
    const page = pageTables(host);
    if (!page || !active) return null;
    return evaluatorFor(page, active.at.column, active.at.row - (active.header ? 1 : 0));
  }, [host, active]);
  const cell = active ? gridAddress(active.at.row, active.at.column, active.header) : null;
  const next = step?.next;

  return (
    <Dialog
      title={t('sheetFormula.evaluate.title')}
      size="medium"
      onDismiss={onClose}
      actions={[
        { id: 'close', label: t('sheetFormula.evaluate.close'), variant: 'secondary', onPress: onClose },
        {
          id: 'restart',
          label: t('sheetFormula.evaluate.restart'),
          variant: 'secondary',
          onPress: () => setStep(start),
        },
        {
          id: 'step',
          label: t('sheetFormula.evaluate.step'),
          variant: 'primary',
          disabled: !next || !evaluate,
          onPress: () => {
            if (step && evaluate) setStep(evaluateStep(step, evaluate));
          },
        },
      ]}
    >
      {!step || !cell ? (
        <p>{t('sheetFormula.evaluate.none')}</p>
      ) : (
        <>
          <p>{t('sheetFormula.evaluate.formula', { cell })}</p>
          <p className={styles.mirrorStatic} data-evaluate-text="" aria-live="polite">
            =
            {next ? (
              <>
                {step.text.slice(0, next.start)}
                <u>{step.text.slice(next.start, next.end)}</u>
                {step.text.slice(next.end)}
              </>
            ) : (
              step.text
            )}
          </p>
          <p className={styles.detail}>
            {next ? t('sheetFormula.evaluate.next') : t('sheetFormula.evaluate.done', { value: step.text })}
          </p>
        </>
      )}
    </Dialog>
  );
}
