// The example subject tool (README.md walks through it): type or paste values one per line, set the hypothesized
// median and the alternative, and read the counts, the exact p-value in words, the worked steps, and a dot plot.
// Insert puts any of them, or a live calculation block, on the page. It is not registered in the app; a lane's tool
// copies its shape.
import { useMemo } from 'react';
import type { KitResultRow, KitToolProps } from '../../kits/types';
import { ChoiceField, QuantityField } from '../../kits/ui/fields';
import { InsertMenu } from '../../kits/ui/InsertMenu';
import { KitPlot } from '../../kits/ui/KitPlot';
import { Assumptions, Problem, ResultTable, StepsView } from '../../kits/ui/output';
import { plotSvg } from '../../kits/ui/plot';
import { quantity, readQuantity } from '../../kits/ui/quantity';
import type { QuantityInput } from '../../kits/ui/quantity';
import { say } from '../../kits/ui/words';
import styles from '../../kits/ui/kit.module.css';
import type { Alternative } from '../stats/dist';
import { ListField } from '../ui/fields';
import { readList } from '../ui/input';
import { formatNumber, sayS, subjectProblem } from '../ui/words';
import { signTest } from './signTest';

interface SignInputs {
  values: string;
  median: QuantityInput;
  alternative: Alternative;
}

const FIRST: SignInputs = {
  values: '1.2\n0.4\n2.2\n0.9\n3.1\n0.5\n1.7\n-0.6\n0.8\n1.1',
  median: quantity(0, ''),
  alternative: 'two-sided',
};

const restore = (saved: unknown): SignInputs =>
  saved && typeof saved === 'object' ? { ...FIRST, ...(saved as Partial<SignInputs>) } : FIRST;

export default function SignTestTool({ inputs: saved, setInputs, system }: KitToolProps) {
  const inputs = restore(saved);
  const set = (patch: Partial<SignInputs>) => setInputs({ ...inputs, ...patch });
  const outcome = useMemo(() => {
    const median = readQuantity(inputs.median, 'dimensionless');
    if (!median.ok) return { problem: `${sayS('example.median')}: ${say(median.key, median.vars)}` };
    const list = readList(inputs.values);
    if (list.problems.length > 0) {
      const first = list.problems[0];
      return { problem: sayS('list.notNumber', { line: first.line, text: first.text }) };
    }
    try {
      return { result: signTest(list.values, median.si, inputs.alternative), values: list.values, median: median.si };
    } catch (error) {
      return { problem: subjectProblem(error) };
    }
  }, [inputs]);

  const result = 'result' in outcome ? outcome.result : null;
  const rows: KitResultRow[] = result
    ? [
        { id: 'p', label: sayS('coef.p'), value: formatNumber(result.p, 4), unit: '', answer: true },
        { id: 'plus', label: sayS('example.plus'), value: String(result.plus), unit: '' },
        { id: 'minus', label: sayS('example.minus'), value: String(result.minus), unit: '' },
        { id: 'ties', label: sayS('example.ties'), value: String(result.ties), unit: '' },
      ]
    : [];
  const verdict = result ? sayS(result.p < 0.05 ? 'example.reject' : 'example.keep') : '';
  const spec =
    result && 'values' in outcome && outcome.values
      ? {
          title: sayS('example.title'),
          x: { label: sayS('plot.values') },
          y: { label: '', min: 0, max: 2 },
          series: [
            {
              name: sayS('plot.data'),
              points: outcome.values.map((v): [number, number] => [v, 1]),
              style: 'markers' as const,
            },
          ],
          lines: [{ x: outcome.median ?? 0 }],
        }
      : null;
  const answer = result ? `p = ${formatNumber(result.p, 4)}` : '';

  return (
    <div className={styles.tool}>
      <ListField label={sayS('example.values')} value={inputs.values} onChange={(values) => set({ values })} />
      <div className={styles.row}>
        <QuantityField
          label={sayS('example.median')}
          kind="dimensionless"
          system={system}
          value={inputs.median}
          onChange={(median) => set({ median })}
        />
        <ChoiceField
          label={sayS('example.alternative')}
          value={inputs.alternative}
          options={(['two-sided', 'greater', 'less'] as const).map((value) => ({
            value,
            label: sayS(`example.${value === 'two-sided' ? 'twoSided' : value}`),
          }))}
          onChange={(alternative) => set({ alternative })}
        />
      </div>
      <Problem text={'problem' in outcome ? (outcome.problem ?? '') : ''} />
      <ResultTable rows={rows} />
      {verdict && <p className={styles.note}>{verdict}</p>}
      {result && <StepsView steps={result.steps} />}
      {spec && <KitPlot spec={spec} />}
      <Assumptions items={[sayS('example.assumption')]} />
      <div className={styles.buttons}>
        <InsertMenu
          disabled={!result}
          content={{
            answer,
            rows,
            steps: result?.steps,
            picture: spec ? { svg: plotSvg(spec), alt: sayS('example.alt') } : undefined,
            summary: `${sayS('example.title')}: ${answer}`,
          }}
          live={{ kit: 'example', tool: 'signTest', title: sayS('example.title'), inputs }}
        />
      </div>
    </div>
  );
}
