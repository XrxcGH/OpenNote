// The example kit tool (README.md walks through it): pick the unknown, type the other three quantities with their
// units, and read the answer, the worked steps, and the assumption. Insert puts any of them, or a live calculation
// block, into the page. Every lane's tools follow this shape.
import { useMemo } from 'react';
import { problemWords, say } from '../../ui/words';
import { ChoiceField, QuantityField } from '../../ui/fields';
import { InsertMenu } from '../../ui/InsertMenu';
import { Assumptions, Problem, ResultTable, StepsView } from '../../ui/output';
import type { QuantityInput } from '../../ui/quantity';
import { inSystem, quantity, readQuantity, showQuantity } from '../../ui/quantity';
import type { KitResultRow, KitToolProps } from '../../types';
import type { QuantityKind } from '../../units';
import { idealGas } from './engine';
import type { GasKnowns, GasUnknown } from './engine';
import styles from '../../ui/kit.module.css';

interface GasInputs {
  unknown: GasUnknown;
  p: QuantityInput;
  V: QuantityInput;
  n: QuantityInput;
  T: QuantityInput;
}

const FIRST: GasInputs = {
  unknown: 'V',
  p: quantity(101.325, 'kPa'),
  V: quantity(22.4, 'L'),
  n: quantity(1, 'mol'),
  T: quantity(273.15, 'K'),
};

const FIELDS: readonly { key: GasUnknown; kind: QuantityKind; label: string }[] = [
  { key: 'p', kind: 'pressure', label: 'kits.example.pressure' },
  { key: 'V', kind: 'volume', label: 'kits.example.volume' },
  { key: 'n', kind: 'amount', label: 'kits.example.amount' },
  { key: 'T', kind: 'temperature', label: 'kits.example.temperature' },
];

/** Saved inputs merged over the first values, so a block from an older version still opens. */
function restore(saved: unknown): GasInputs {
  return saved && typeof saved === 'object' ? { ...FIRST, ...(saved as Partial<GasInputs>) } : FIRST;
}

function work(inputs: GasInputs): { knowns: GasKnowns } | { problem: string } {
  const knowns: GasKnowns = { p: NaN, V: NaN, n: NaN, T: NaN };
  for (const field of FIELDS) {
    if (field.key === inputs.unknown) continue;
    const read = readQuantity(inputs[field.key], field.kind);
    if (!read.ok) return { problem: `${say(field.label)}: ${say(read.key, read.vars)}` };
    knowns[field.key] = read.si;
  }
  return { knowns };
}

export default function IdealGasTool({ inputs: saved, setInputs, system }: KitToolProps) {
  const inputs = restore(saved);
  const set = (patch: Partial<GasInputs>) => setInputs({ ...inputs, ...patch });
  const outcome = useMemo(() => {
    const read = work(inputs);
    if ('problem' in read) return { problem: read.problem };
    try {
      return { result: idealGas(inputs.unknown, read.knowns) };
    } catch (error) {
      return { problem: problemWords(error) };
    }
  }, [inputs]);

  const result = 'result' in outcome ? outcome.result : null;
  const rows: KitResultRow[] = result
    ? FIELDS.map((field) => ({
        id: field.key,
        label: say(field.label),
        ...showQuantity(result.values[field.key], field.kind, system),
        answer: field.key === inputs.unknown,
      }))
    : [];
  const answer = rows.find((row) => row.answer);
  const answerText = answer ? `${inputs.unknown} = ${answer.value} ${answer.unit}` : '';

  return (
    <div className={styles.tool}>
      <div className={styles.row}>
        <ChoiceField
          label={say('kits.example.solveFor')}
          value={inputs.unknown}
          options={FIELDS.map((field) => ({ value: field.key, label: say(field.label) }))}
          onChange={(unknown) => set({ unknown })}
        />
      </div>
      <div className={styles.row}>
        {FIELDS.filter((field) => field.key !== inputs.unknown).map((field) => (
          <QuantityField
            key={field.key}
            label={say(field.label)}
            kind={field.kind}
            system={system}
            value={inSystem(inputs[field.key], field.kind, system)}
            onChange={(next) => set({ [field.key]: next })}
            rules={{ positive: true }}
          />
        ))}
      </div>
      <Problem text={'problem' in outcome ? (outcome.problem ?? '') : ''} />
      <ResultTable rows={rows} />
      {result && <StepsView steps={result.steps} />}
      <Assumptions items={[say('kits.example.assumption')]} />
      <div className={styles.buttons}>
        <InsertMenu
          disabled={!result}
          content={{
            answer: answerText,
            latex: result?.steps[result.steps.length - 1]?.math,
            rows,
            steps: result?.steps,
            summary: `${say('kits.example.title')}: ${answerText}`,
          }}
          live={{ kit: 'example', tool: 'idealGas', title: say('kits.example.title'), inputs }}
        />
      </div>
    </div>
  );
}
