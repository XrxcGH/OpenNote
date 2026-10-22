// Math and science (flag ink.myHandwriting): an optional pen section, open once the calibration page is done, for
// Greek letters, operators, arrows, accents, and brackets small and tall, so typed math comes out in the person's
// hand. Its boxes save as they are written, and closing it adds them to the style.
import { createRoot } from 'react-dom/client';
import { t } from '../../../../strings/t';
import { announce, Dialog } from '../../../../ui';
import { MATH_SYMBOLS, SAMPLES_PER_CHAR, isStyleChar, mathSampleId } from '../../myhand/charset';
import { SampleGrid } from './SampleGrid';
import type { GridRow } from './SampleGrid';
import { rebuildStyle } from './store';
import styles from './myhand.module.css';

/** Brackets and bars are asked for small and tall, as people draw tall ones differently. */
export const STRETCHY = ['(', ')', '[', ']', '{', '}', '|', '√', '∫'] as const;

export function mathRows(only?: readonly string[]): GridRow[] {
  // Any character the writer had to borrow can be added here, not only the math symbols.
  const chars = only ? only.filter((c) => isStyleChar(c)) : MATH_SYMBOLS;
  const rows: GridRow[] = chars.map((char) => ({
    char,
    ids: Array.from({ length: SAMPLES_PER_CHAR }, (_, n) => mathSampleId(char, n)),
  }));
  for (const char of STRETCHY) {
    if (only && !only.includes(char)) continue;
    rows.push({ char, tall: true, ids: [mathSampleId(char, 3), mathSampleId(char, 4)] });
  }
  return rows;
}

function MathPenDialog(props: { done: () => void; only?: readonly string[] }) {
  const finish = async () => {
    await rebuildStyle();
    announce(t('myHand.math.saved'));
    props.done();
  };
  return (
    <Dialog
      title={t('myHand.math.title')}
      description={t('myHand.math.intro')}
      size="large"
      onDismiss={() => void finish()}
      actions={[{ id: 'done', label: t('myHand.math.done'), variant: 'primary', onPress: finish }]}
    >
      <div className={styles.page} data-myhand-math="">
        <p className={styles.lead}>{t('myHand.calibration.groupHint')}</p>
        <SampleGrid rows={mathRows(props.only)} />
      </div>
    </Dialog>
  );
}

/** Opens the Math and science section, for every symbol or only the ones given. */
export function showMathPen(only?: readonly string[]): Promise<void> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = () => {
      resolve();
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<MathPenDialog done={done} only={only} />);
  });
}
