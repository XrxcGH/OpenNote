// Series and convergence: type a term to see which tests apply, what each one says, the verdict, the sum when it is
// known, and the interval of convergence for a power series.
import { t } from '../../../../strings/t';
import { fmt } from '../numeric';
import {
  Choice,
  InsertBar,
  LinePlot,
  MathView,
  Note,
  Problem,
  Result,
  Steps,
  TextInput,
  useSolved,
  useStored,
} from '../ui/parts';
import styles from '../ui/mathkit.module.css';
import { analyzePowerSeries, analyzeSeries, type SeriesResult } from './engine';

const FIRST = { mode: 'series', term: '1/n^2', start: '1', center: '0' };
const SAMPLE_POWER = '(x-2)^n/(3^n*n^2)';

const verdictKey = {
  absolute: 'kitMath.series.verdictAbsolute',
  conditional: 'kitMath.series.verdictConditional',
  diverges: 'kitMath.series.verdictDiverges',
  unknown: 'kitMath.series.verdictUnknown',
} as const;

export default function SeriesTool() {
  const [state, set] = useStored('series', FIRST);
  const power = state.mode === 'power';
  const { result, problem } = useSolved({ ...state }, (input) =>
    input.mode === 'power'
      ? { power: analyzePowerSeries(input.term, input.center, Number(input.start)), plain: null }
      : { plain: analyzeSeries(input.term, Number(input.start)), power: null },
  );
  const plain: SeriesResult | null = result?.plain ?? null;
  const pw = result?.power ?? null;
  const steps = plain?.steps ?? pw?.steps ?? [];
  const headline = plain
    ? t(verdictKey[plain.verdict])
    : pw
      ? t('kitMath.series.interval', { interval: pw.interval })
      : '';
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Choice
          label={t('kitMath.series.mode')}
          value={state.mode as 'series' | 'power'}
          options={[
            { value: 'series', label: t('kitMath.series.modeSeries') },
            { value: 'power', label: t('kitMath.series.modePower') },
          ]}
          onChange={(mode) =>
            set({
              mode,
              term: mode === 'power' ? SAMPLE_POWER : FIRST.term,
              center: mode === 'power' ? '2' : '0',
              start: mode === 'power' ? '1' : '1',
            })
          }
        />
        <TextInput label={t('kitMath.series.start')} value={state.start} onChange={(value) => set({ start: value })} />
        {power ? (
          <TextInput
            label={t('kitMath.series.center')}
            value={state.center}
            onChange={(value) => set({ center: value })}
          />
        ) : null}
        <TextInput
          wide
          label={power ? t('kitMath.series.termPower') : t('kitMath.series.term')}
          value={state.term}
          invalid={problem !== ''}
          onChange={(value) => set({ term: value })}
        />
      </div>
      <Note>{t('kitMath.series.assumptions')}</Note>
      <Note>{t('kitMath.series.hint')}</Note>
      <Problem text={problem} />
      {result ? (
        <>
          <Result>{headline}</Result>
          {plain && plain.sum !== null ? (
            <>
              <Result>
                {plain.sumLatex
                  ? t('kitMath.series.sumExact', { sum: plain.sumLatex.replace(/\\/g, ''), value: fmt(plain.sum, 10) })
                  : t('kitMath.series.sum', { sum: fmt(plain.sum, 10) })}
              </Result>
              {plain.sumLatex ? <MathView latex={`\\sum = ${plain.sumLatex}`} /> : null}
            </>
          ) : null}
          {pw ? (
            <>
              <Result>
                {t('kitMath.series.radius', {
                  radius: pw.radius === Infinity ? '∞' : fmt(pw.radius, 8),
                })}
              </Result>
              <MathView latex={`x\\in ${pw.intervalLatex}`} />
            </>
          ) : null}
          {plain ? (
            <LinePlot
              label={t('kitMath.series.plot')}
              series={[{ points: plain.partial }, { points: plain.partial, dots: true }]}
            />
          ) : null}
          <Steps steps={steps} />
          <InsertBar
            answer={`${headline}${plain && plain.sum !== null ? ` ${t('kitMath.series.sum', { sum: fmt(plain.sum, 10) })}` : ''}`}
            latex={
              plain?.steps[0]?.math && plain.sumLatex
                ? `${plain.steps[0].math} = ${plain.sumLatex}`
                : pw
                  ? `x\\in ${pw.intervalLatex}`
                  : undefined
            }
            steps={steps}
          />
        </>
      ) : null}
    </div>
  );
}
