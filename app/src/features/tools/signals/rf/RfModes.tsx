// The RF tool's network tabs: two-port parameter conversion with stability and cascades, noise cascades by Friis's
// formula, antenna links and the radar range equation, and decibel conversions.
import { useMemo } from 'react';
import { fmt, fmtComplex, readRows } from '../shared/num';
import {
  Answer,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertMenu,
  Problem,
  Results,
  StepList,
  TextBox,
  attempt,
  num,
  useStored,
  type TableData,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import { w } from './words';
import {
  DB_UNITS,
  PARAMETER_SETS,
  cascade,
  convertDb,
  friisLink,
  friisNoise,
  fromAbcd,
  noiseTemperature,
  radar,
  readComplex,
  stability,
  toAbcd,
  type DbUnit,
  type Matrix2,
  type ParameterSet,
} from './twoport';

const NAMES: Record<ParameterSet, [string, string, string, string]> = {
  S: ['S11', 'S12', 'S21', 'S22'],
  Z: ['Z11', 'Z12', 'Z21', 'Z22'],
  Y: ['Y11', 'Y12', 'Y21', 'Y22'],
  ABCD: ['A', 'B', 'C', 'D'],
};

/** Reads one matrix per block of two lines: "a b" then "c d", complex entries separated by spaces or commas. */
function readMatrices(text: string): Matrix2[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length % 2) throw new Error('rows');
  const matrices: Matrix2[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const cells = [...lines[i]!.split(/[\s,;]+/), ...lines[i + 1]!.split(/[\s,;]+/)].filter(Boolean).map(readComplex);
    if (cells.length !== 4) throw new Error('cells');
    matrices.push(cells as unknown as Matrix2);
  }
  return matrices;
}

function twoPortResult(state: { set: ParameterSet; values: string; z0: string }) {
  const z0 = num(state.z0);
  let matrices: Matrix2[];
  try {
    matrices = readMatrices(state.values);
  } catch (error) {
    if (error instanceof Error && (error.message === 'rows' || error.message === 'cells')) {
      return { problem: w('matrixShape') };
    }
    throw error;
  }
  const abcd = cascade(matrices.map((m) => toAbcd(state.set, m, z0)));
  const s = fromAbcd('S', abcd, z0)!;
  const table: TableData = {
    header: [w('parameter'), ...PARAMETER_SETS],
    rows: [0, 1, 2, 3].map((i) => [
      String(i + 1),
      ...PARAMETER_SETS.map((set) => {
        const m = fromAbcd(set, abcd, z0);
        return m ? `${NAMES[set][i]} = ${fmtComplex(m[i]!, 5)}` : w('none');
      }),
    ]),
  };
  // A network with S12 or S21 of 0 has no stability factor; the conversions still show.
  const stable = attempt(() => stability(s));
  return { matrices: matrices.length, table, stable: stable.ok ? stable.value : null };
}

export function TwoPortMode() {
  const [state, set] = useStored('rf.twoPort', {
    set: 'S' as ParameterSet,
    values: '0.3∠-40 0.05∠60\n4∠120 0.5∠-30',
    z0: '50',
  });
  const outcome = useMemo(() => attempt(() => twoPortResult(state)), [state]);
  return (
    <>
      <Fields>
        <Choice
          label={w('given')}
          value={state.set}
          options={PARAMETER_SETS}
          name={(p) => p}
          onChange={(next) => set({ set: next })}
        />
        <Field label={w('z0')} value={state.z0} onChange={(z0) => set({ z0 })} unit="Ω" />
        <TextBox
          label={w('matrices')}
          value={state.values}
          onChange={(values) => set({ values })}
          hint={w('matricesHint')}
          rows={4}
        />
      </Fields>
      {!outcome.ok ? (
        <Problem text={outcome.problem} />
      ) : 'problem' in outcome.value ? (
        <Problem text={outcome.value.problem ?? ''} />
      ) : (
        <>
          <Answer
            text={
              outcome.value.stable
                ? w(outcome.value.stable.unconditional ? 'stableAnswer' : 'potentialAnswer', {
                    k: fmt(outcome.value.stable.k, 5),
                    mu: fmt(outcome.value.stable.mu, 5),
                  })
                : w('cascadeAnswer', { count: outcome.value.matrices })
            }
          />
          {outcome.value.stable ? (
            <Results
              rows={[
                ['|Δ|', fmt(outcome.value.stable.delta, 5)],
                [w(outcome.value.stable.gainKind), `${fmt(outcome.value.stable.gainDb, 5)} dB`],
              ]}
            />
          ) : null}
          <DataTable caption={w('conversions')} table={outcome.value.table} />
          <StepList steps={outcome.value.stable?.steps ?? []} />
          <InsertMenu
            answer={w('cascadeAnswer', { count: outcome.value.matrices })}
            table={outcome.value.table}
            latex={String.raw`K = \frac{1 - |S_{11}|^2 - |S_{22}|^2 + |\Delta|^2}{2|S_{12}S_{21}|}`}
            steps={outcome.value.stable?.steps ?? []}
          />
        </>
      )}
    </>
  );
}

export function NoiseMode() {
  const [state, set] = useStored('rf.noise', { stages: '20 2\n10 6', single: '3' });
  const outcome = useMemo(
    () =>
      attempt(() =>
        friisNoise(readRows(state.stages).map((row) => ({ gainDb: row[0] ?? NaN, noiseFigureDb: row[1] ?? NaN }))),
      ),
    [state.stages],
  );
  const single = num(state.single);
  return (
    <>
      <Fields>
        <TextBox
          label={w('stages')}
          value={state.stages}
          onChange={(stages) => set({ stages })}
          hint={w('stagesHint')}
          rows={4}
        />
        <Field label={w('oneFigure')} value={state.single} onChange={(next) => set({ single: next })} unit="dB" />
      </Fields>
      {Number.isFinite(single) && single >= 0 ? (
        <Results rows={[[w('oneTemperature'), `${fmt(noiseTemperature(single))} K`]]} />
      ) : null}
      {outcome.ok ? (
        <>
          <Answer
            text={w('noiseAnswer', { nf: fmt(outcome.value.noiseFigureDb), te: fmt(outcome.value.noiseTemperature) })}
          />
          <Results rows={[[w('totalGain'), `${fmt(outcome.value.gainDb)} dB`]]} />
          <DataTable
            caption={w('stagesTable')}
            table={{ header: [w('stage'), w('factor'), w('added')], rows: outcome.value.rows }}
          />
          <StepList steps={outcome.value.steps} />
          <InsertMenu
            answer={w('noiseAnswer', { nf: fmt(outcome.value.noiseFigureDb), te: fmt(outcome.value.noiseTemperature) })}
            latex={String.raw`F = F_1 + \frac{F_2 - 1}{G_1} + \frac{F_3 - 1}{G_1 G_2} + \cdots`}
            steps={outcome.value.steps}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

const ANTENNA = {
  pt: '20',
  gt: '6',
  gr: '3',
  frequency: '2.4e9',
  distance: '100',
  radarPt: '1000',
  radarGain: '30',
  rcs: '1',
  range: '10000',
  minimum: '-100',
};

export function AntennaMode() {
  const [state, set] = useStored('rf.antenna', ANTENNA);
  const link = useMemo(
    () =>
      attempt(() => friisLink(num(state.pt), num(state.gt), num(state.gr), num(state.frequency), num(state.distance))),
    [state],
  );
  const echo = useMemo(
    () =>
      attempt(() =>
        radar(
          num(state.radarPt),
          num(state.radarGain),
          num(state.frequency),
          num(state.rcs),
          num(state.range),
          num(state.minimum),
        ),
      ),
    [state],
  );
  const field = (key: keyof typeof ANTENNA, unit?: string) => (
    <Field
      label={w(`antenna.${key}`)}
      value={state[key]}
      onChange={(value) => set({ [key]: value })}
      {...(unit ? { unit } : {})}
    />
  );
  return (
    <>
      <Fields>
        {field('pt', 'dBm')}
        {field('gt', 'dBi')}
        {field('gr', 'dBi')}
        {field('frequency', 'Hz')}
        {field('distance', 'm')}
      </Fields>
      {link.ok ? (
        <>
          <Answer text={w('linkAnswer', { pr: fmt(link.value.receivedDbm), loss: fmt(link.value.pathLossDb) })} />
          <Results
            rows={[
              ['EIRP', `${fmt(link.value.eirpDbm)} dBm`],
              [w('wavelength'), `${fmt(link.value.wavelength)} m`],
              [w('aperture'), `${fmt(link.value.apertureRx)} m²`],
            ]}
          />
          <StepList steps={link.value.steps} />
          <InsertMenu
            answer={w('linkAnswer', { pr: fmt(link.value.receivedDbm), loss: fmt(link.value.pathLossDb) })}
            latex={String.raw`P_r = P_t + G_t + G_r - 20\log_{10}\frac{4\pi d}{\lambda}`}
            steps={link.value.steps}
          />
        </>
      ) : (
        <Problem text={link.problem} />
      )}
      <h3 className={styles.heading}>{w('radarHeading')}</h3>
      <Fields>
        {field('radarPt', 'W')}
        {field('radarGain', 'dBi')}
        {field('rcs', 'm²')}
        {field('range', 'm')}
        {field('minimum', 'dBm')}
      </Fields>
      {echo.ok ? (
        <>
          <Answer text={w('radarAnswer', { pr: fmt(echo.value.receivedDbm), range: fmt(echo.value.maxRange) })} />
          <StepList steps={echo.value.steps} />
        </>
      ) : (
        <Problem text={echo.problem} />
      )}
    </>
  );
}

function DecibelResults({ values }: { values: Record<DbUnit, number> }) {
  const rows = DB_UNITS.filter((u) => Number.isFinite(values[u])).map(
    (u) => [w(`units.${u}`), fmt(values[u], 7)] as [string, string],
  );
  return (
    <>
      <Results rows={rows} />
      <InsertMenu table={{ header: [w('unit'), w('value')], rows }} />
    </>
  );
}

export function DecibelMode() {
  const [state, set] = useStored('rf.decibels', { value: '0', unit: 'dBm' as DbUnit, resistance: '50' });
  const outcome = useMemo(
    () => attempt(() => convertDb(num(state.value), state.unit, num(state.resistance))!),
    [state],
  );
  return (
    <>
      <Fields>
        <Field label={w('value')} value={state.value} onChange={(value) => set({ value })} />
        <Choice
          label={w('unit')}
          value={state.unit}
          options={DB_UNITS}
          name={(u) => w(`units.${u}`)}
          onChange={(unit) => set({ unit })}
        />
        <Field
          label={w('resistance')}
          value={state.resistance}
          onChange={(resistance) => set({ resistance })}
          unit="Ω"
        />
      </Fields>
      {outcome.ok ? <DecibelResults values={outcome.value} /> : <Problem text={outcome.problem} />}
    </>
  );
}
