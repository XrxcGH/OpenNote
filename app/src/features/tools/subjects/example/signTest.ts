// The example subject tool's engine (README.md walks through it): the one-sample sign test. Each value above the
// hypothesized median is a plus, each below a minus, and values equal to it are dropped. Under the null hypothesis
// the number of pluses is binomial with p = 1/2, so the p-value is exact. Pure: numbers in, numbers and steps out.
import type { KitStep } from '../../kits/types';
import { binomialCdf, binomialSf } from '../stats/dist';
import type { Alternative } from '../stats/dist';
import { ensure } from '../errors';

export interface SignTestResult {
  plus: number;
  minus: number;
  ties: number;
  /** Values used: plus + minus. */
  n: number;
  p: number;
  steps: KitStep[];
}

const K = 'kitSubjects.example.step';

export function signTest(
  values: readonly number[],
  median = 0,
  alternative: Alternative = 'two-sided',
): SignTestResult {
  ensure(values.length > 0, 'empty', 'values');
  ensure(values.every(Number.isFinite) && Number.isFinite(median), 'notFinite', 'values');
  const plus = values.filter((v) => v > median).length;
  const minus = values.filter((v) => v < median).length;
  const ties = values.length - plus - minus;
  const n = plus + minus;
  ensure(n > 0, 'tooFew', 'values');
  const lower = binomialCdf(plus, n, 0.5);
  const upper = binomialSf(plus - 1, n, 0.5);
  const p =
    alternative === 'greater' ? upper : alternative === 'less' ? lower : Math.min(1, 2 * Math.min(lower, upper));
  const steps: KitStep[] = [
    { key: `${K}.count`, vars: { plus, minus, ties, median } },
    { key: `${K}.null`, vars: { n }, math: `S \\sim \\mathrm{Binomial}(${n},\\ 0.5)` },
    {
      key: `${K}.${alternative === 'two-sided' ? 'twoSided' : alternative}`,
      vars: { plus },
      math:
        alternative === 'greater'
          ? `p = P(S \\ge ${plus}) = ${p.toPrecision(6)}`
          : alternative === 'less'
            ? `p = P(S \\le ${plus}) = ${p.toPrecision(6)}`
            : `p = 2\\min\\{P(S \\le ${plus}),\\ P(S \\ge ${plus})\\} = ${p.toPrecision(6)}`,
    },
  ];
  return { plus, minus, ties, n, p, steps };
}
