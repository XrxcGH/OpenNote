// The Solids of revolution tool window: the region between two curves, turned about a horizontal or vertical line,
// with its volume by disks, washers, or shells, the steps a course writes, and a 3D view of the solid that turns.
// "Insert into page" adds the steps as text and the solid as a 3D graph block.
import { useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Graph3DView } from '../Graph3DView';
import { revolveVolume, type RevolveMethod, type RevolveStep } from '../revolve';
import { writeSpace, readSpace, type RevolveSpec } from '../source3d';
import { readNumber } from '../vec';
import { TextField } from '../../../../ui';
import { InsertResult, NumberField } from './common';
import styles from './lab.module.css';

const STEP_KEYS = {
  diskSetup: 'graph3d.tools.solids.stepDiskSetup',
  shellSetup: 'graph3d.tools.solids.stepShellSetup',
  radii: 'graph3d.tools.solids.stepRadii',
  shellParts: 'graph3d.tools.solids.stepShellParts',
  diskFormula: 'graph3d.tools.solids.stepDiskFormula',
  shellFormula: 'graph3d.tools.solids.stepShellFormula',
  integral: 'graph3d.tools.solids.stepIntegral',
  volume: 'graph3d.tools.solids.stepVolume',
  exact: 'graph3d.tools.solids.stepExact',
  verticalDisk: 'graph3d.tools.solids.verticalDisk',
  horizontalShell: 'graph3d.tools.solids.horizontalShell',
} as const;

export const stepText = (step: RevolveStep): string =>
  // Each step's values are the ones its message names (revolve.ts).
  (t as (key: string, values: Readonly<Record<string, string>>) => string)(STEP_KEYS[step.id], step.values);

export function SolidsTool() {
  const [outer, setOuter] = useState('sqrt(x)');
  const [inner, setInner] = useState('0');
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState('4');
  const [axisKind, setAxisKind] = useState<'x' | 'y'>('y');
  const [axisAt, setAxisAt] = useState('0');
  const [method, setMethod] = useState<RevolveMethod>('auto');

  const spec: RevolveSpec | null = useMemo(() => {
    const [a, b, k] = [readNumber(from), readNumber(to), readNumber(axisAt)];
    if (![a, b, k].every(Number.isFinite) || a >= b || outer.trim() === '') return null;
    return { outer: outer.trim(), inner: inner.trim() || '0', from: a, to: b, axis: { kind: axisKind, at: k } };
  }, [outer, inner, from, to, axisKind, axisAt]);
  const result = useMemo(() => (spec ? revolveVolume(spec, method) : null), [spec, method]);
  const graph = spec && result?.ok ? writeSpace({ ...readSpace('@3d'), revolve: spec }) : null;
  const [edited, setEdited] = useState<{ from: string; text: string } | null>(null);
  const shown = graph && edited?.from === graph ? edited.text : graph;

  const steps = result?.ok ? result.steps.map(stepText) : [];
  const volume = result?.ok ? String(Number(result.volume.toPrecision(8))) : '';
  return (
    <div className={styles.tool}>
      <div className={styles.fields}>
        <TextField label={t('graph3d.tools.solids.outer')} value={outer} onChange={setOuter} />
        <TextField label={t('graph3d.tools.solids.inner')} value={inner} onChange={setInner} />
        <NumberField label={t('graph3d.tools.solids.from')} value={from} onChange={setFrom} />
        <NumberField label={t('graph3d.tools.solids.to')} value={to} onChange={setTo} />
        <label className={styles.select}>
          <span>{t('graph3d.tools.solids.axis')}</span>
          <select value={axisKind} onChange={(event) => setAxisKind(event.target.value as 'x' | 'y')}>
            <option value="y">{t('graph3d.tools.solids.axisKinds.y')}</option>
            <option value="x">{t('graph3d.tools.solids.axisKinds.x')}</option>
          </select>
        </label>
        <NumberField label={t('graph3d.tools.solids.axisAt')} value={axisAt} onChange={setAxisAt} />
        <label className={styles.select}>
          <span>{t('graph3d.tools.solids.method')}</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as RevolveMethod)}>
            {(['auto', 'disk', 'shell'] as const).map((one) => (
              <option key={one} value={one}>
                {t(`graph3d.tools.solids.methods.${one}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result && !result.ok ? (
        <p className={styles.problem} role="status">
          {t('graph3d.tools.solids.bad', { message: result.error.message })}
        </p>
      ) : null}
      {result?.ok ? (
        <>
          <p className={styles.answer} role="status">
            {t('graph3d.tools.solids.volume', { value: volume })}
            {result.exact ? ` ${t('graph3d.tools.solids.exact', { value: result.exact })}` : ''}
          </p>
          <h3 className={styles.note}>{t('graph3d.tools.solids.steps')}</h3>
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      ) : null}
      {shown ? (
        <Graph3DView source={shown} editable onSource={(next) => setEdited({ from: graph!, text: next })} />
      ) : null}
      {graph && result?.ok ? (
        <div className={styles.actions}>
          <InsertResult text={steps.join(' ')} graph={graph} />
        </div>
      ) : null}
    </div>
  );
}
