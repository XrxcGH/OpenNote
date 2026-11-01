// Numerical methods: interpolation, differentiation, integration, differential equations, iterative solvers,
// Newton's method, grids for Laplace, Poisson, and heat problems, curve fitting, and the fast Fourier transform. Each
// shows the method, the first steps in full, a table, the error when the exact value is known, and a plot.
import '../text';
import { t } from '../../../../strings/t';
import { Choice, Note, Problem, TextInput, say, useSolved, useStored } from '../ui/parts';
import styles from '../ui/mathkit.module.css';
import { NumView, lineText } from './NumView';
import { FORMS, topicOptions } from './numericsForms';
import { FIRST, TOPICS, run, type State } from './numericsRun';

export { TOPICS };

export default function NumericsTool() {
  const [s, set] = useStored('numerics', FIRST);
  const { result, problem } = useSolved({ ...s }, run);
  const text = (key: keyof State, label: string, extra: { wide?: boolean; rows?: number } = {}) => (
    <TextInput
      label={label}
      value={String(s[key])}
      invalid={problem !== ''}
      onChange={(value) => set({ [key]: value } as Partial<State>)}
      {...extra}
    />
  );
  const L = (name: string) => say(`kitMath.numerics.field.${name}`);
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Choice
          label={t('kitMath.numerics.topicLabel')}
          value={s.topic}
          options={topicOptions(TOPICS)}
          onChange={(topic) => set({ topic })}
        />
      </div>
      <div className={styles.row}>{FORMS[s.topic]({ s, set, text, L })}</div>
      <Note>{say(`kitMath.numerics.assume.${s.topic}`)}</Note>
      <Problem text={problem} />
      {result ? <NumView out={result} answer={result.lines[0] ? lineText(result.lines[0]) : ''} /> : null}
    </div>
  );
}
