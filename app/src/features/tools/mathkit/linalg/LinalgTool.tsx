// The linear algebra workbench: type a matrix (fractions allowed) and choose what to do with it. Every row operation,
// cofactor, and projection is written out, with the answer in exact fractions where the method allows it.
import '../text';
import { t } from '../../../../strings/t';
import { NumView, lineText } from '../numerics/NumView';
import styles from '../ui/mathkit.module.css';
import { Choice, Note, Problem, TextInput, say, useSolved, useStored } from '../ui/parts';
import { FIRST, OPERATIONS, SAMPLES, run, type Operation, type State } from './run';

const NEEDS_B: readonly Operation[] = ['solve', 'projection', 'lsq', 'coords'];
const NEEDS_C: readonly Operation[] = ['transition', 'map'];

export default function LinalgTool() {
  const [s, set] = useStored('linalg', FIRST);
  const { result, problem } = useSolved({ ...s }, run);
  const L = (name: string) => say(`kitMath.linalg.field.${name}`);
  const field = (key: keyof State, label: string, extra: { wide?: boolean; rows?: number } = {}) => (
    <TextInput
      label={label}
      value={String(s[key])}
      invalid={problem !== ''}
      onChange={(value) => set({ [key]: value } as Partial<State>)}
      {...extra}
    />
  );
  const op = s.op;
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Choice
          label={t('kitMath.linalg.operation')}
          value={op}
          options={OPERATIONS.map((value) => ({ value, label: say(`kitMath.linalg.op.${value}`) }))}
          onChange={(next) => set({ op: next, ...SAMPLES[next] })}
        />
      </div>
      <div className={styles.row}>
        {op === 'polyfit' ? (
          <>
            {field('degree', L('degree'))}
            {field('points', L('points'), { wide: true, rows: 5 })}
          </>
        ) : (
          <>
            {field('A', say(`kitMath.linalg.matrixLabel.${op}`), { wide: true, rows: 4 })}
            {op === 'map' ? field('B', L('basisIn'), { wide: true, rows: 3 }) : null}
            {NEEDS_C.includes(op)
              ? field('C', op === 'map' ? L('basisOut') : L('basisC'), { wide: true, rows: 3 })
              : null}
            {NEEDS_B.includes(op) ? field('b', say(`kitMath.linalg.vectorLabel.${op}`), { wide: true }) : null}
          </>
        )}
      </div>
      <Note>{say(`kitMath.linalg.assume.${op}`)}</Note>
      <Problem text={problem} />
      {result ? (
        <NumView ns="linalg" out={result} answer={result.lines[0] ? lineText(result.lines[0], 'linalg') : ''} />
      ) : null}
    </div>
  );
}
