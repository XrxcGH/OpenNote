// Vector calculus and optimization: gradients and tangent planes, critical points, Lagrange multipliers, divergence and
// curl, line and surface integrals, and Green's, Stokes', and the divergence theorem with both sides worked out.
import '../text';
import { t } from '../../../../strings/t';
import { NumView, lineText } from '../numerics/NumView';
import styles from '../ui/mathkit.module.css';
import { Choice, Note, Problem, TextInput, say, useSolved, useStored } from '../ui/parts';
import { FIRST, OPERATIONS, SAMPLES, run, type State } from './run';
import { FORMS } from './vectorForms';

export default function VectorTool() {
  const [s, set] = useStored('vectorcalc', FIRST);
  const { result, problem } = useSolved({ ...s }, run);
  const L = (name: string) => say(`kitMath.vectorcalc.field.${name}`);
  const show = (key: keyof State, label: string, wide = false) => (
    <TextInput
      label={label}
      value={String(s[key])}
      invalid={problem !== ''}
      onChange={(value) => set({ [key]: value } as Partial<State>)}
      wide={wide}
    />
  );
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Choice
          label={t('kitMath.vectorcalc.operation')}
          value={s.op}
          options={OPERATIONS.map((value) => ({ value, label: say(`kitMath.vectorcalc.op.${value}`) }))}
          onChange={(op) => set({ op, ...SAMPLES[op] })}
        />
      </div>
      <div className={styles.row}>{FORMS[s.op]({ s, set, show, L })}</div>
      <Note>{say(`kitMath.vectorcalc.assume.${s.op}`)}</Note>
      <Problem text={problem} />
      {result ? (
        <NumView ns="vectorcalc" out={result} answer={result.lines[0] ? lineText(result.lines[0], 'vectorcalc') : ''} />
      ) : null}
    </div>
  );
}
