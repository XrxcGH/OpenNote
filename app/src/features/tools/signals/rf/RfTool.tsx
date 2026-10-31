// Transmission lines and RF: one tab per topic. The load tab moves along the line on a Smith chart; matching designs
// L-sections, single stubs, and quarter-wave transformers; line types give Z0. The two-port, noise, antenna, and
// decibel tabs are in RfModes.tsx.
import { useMemo, useRef } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { SignalError } from '../shared/errors';
import { cdiv, cx, fmt, fmtComplex } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Results,
  StepList,
  Tabs,
  attempt,
  num,
  useStored,
  type TableData,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import {
  inputImpedance,
  isOpenLoad,
  readLoad,
  lSection,
  lineParameters,
  quarterWave,
  reflection,
  singleStub,
  smithGrid,
  standingWave,
  vswrCircle,
  type LElement,
  type LineType,
} from './lines';
import { readComplex } from './twoport';
import { AntennaMode, DecibelMode, NoiseMode, TwoPortMode } from './RfModes';
import { w } from './words';

type Mode = 'load' | 'matching' | 'lineTypes' | 'twoPort' | 'noise' | 'antenna' | 'decibels';
const MODES: readonly Mode[] = ['load', 'matching', 'lineTypes', 'twoPort', 'noise', 'antenna', 'decibels'];

const GRID = smithGrid();

const LOAD = { z0: '50', zl: '100+j50', length: '0.125', loss: '0' };

function loadResult(state: typeof LOAD) {
  const z0 = num(state.z0);
  const zl = readLoad(state.zl, readComplex);
  const length = num(state.length);
  const line = inputImpedance(zl, z0, length, num(state.loss) || 0);
  const load = reflection(zl, z0);
  return { z0, zl, length, load, line, wave: standingWave(load.gamma, Math.max(0.5, length)) };
}

function LoadMode() {
  const [state, set] = useStored('rf.load', LOAD);
  const chart = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => loadResult(state)), [state]);
  const fields = (
    <Fields>
      <Field label={w('z0')} value={state.z0} onChange={(z0) => set({ z0 })} unit="Ω" />
      <Field label={w('zl')} value={state.zl} onChange={(zl) => set({ zl })} unit="Ω" hint={w('loadHint')} />
      <div className={styles.actions} role="group" aria-label={w('loadPresets')}>
        <Button variant="quiet" onClick={() => set({ zl: '0' })}>
          {w('shortLoad')}
        </Button>
        <Button variant="quiet" onClick={() => set({ zl: 'open' })}>
          {w('openLoad')}
        </Button>
      </div>
      <Field label={w('length')} value={state.length} onChange={(length) => set({ length })} unit="λ" />
      <Field label={w('loss')} value={state.loss} onChange={(loss) => set({ loss })} unit={w('dbPerWavelength')} />
    </Fields>
  );
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const { z0, load, line, wave } = outcome.value;
  const yin = isOpenLoad(line.zin) ? cx(0) : cdiv(cx(1), line.zin);
  const answer = w('loadAnswer', {
    gamma: fmtComplex(load.gamma, 5),
    vswr: fmt(load.vswr, 5),
    zin: fmtComplex(line.zin, 5),
  });
  const circle = vswrCircle(load.magnitude);
  return (
    <>
      {fields}
      <label className={styles.field}>
        <span>{w('towardGenerator')}</span>
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.005}
          value={Math.min(0.5, Math.max(0, num(state.length) || 0))}
          aria-valuetext={`${state.length} λ`}
          onChange={(event) => set({ length: event.target.value })}
        />
      </label>
      <Answer text={answer} />
      <Results
        rows={[
          ['|Γ|', `${fmt(load.magnitude)} ∠ ${fmt(load.angleDeg, 5)}°`],
          [w('returnLoss'), `${fmt(load.returnLossDb)} dB`],
          [w('mismatchLoss'), `${fmt(load.mismatchLossDb)} dB`],
          [w('zinLabel'), `${fmtComplex(line.zin)} Ω`],
          [w('yinLabel'), `${fmtComplex(yin)} S`],
        ]}
      />
      <Plot
        ref={chart}
        title={w('smithTitle')}
        spec={{
          series: [
            { label: w('grid'), x: GRID.x, y: GRID.y, tone: 4 },
            { label: w('vswrCircle'), x: circle.x, y: circle.y, tone: 3, dashed: true },
            { label: w('loadPoint'), x: [load.gamma.re], y: [load.gamma.im], kind: 'dots', tone: 1 },
            { label: w('inputPoint'), x: [line.gammaIn.re], y: [line.gammaIn.im], kind: 'dots', tone: 2 },
          ],
          xLabel: w('gammaRe'),
          yLabel: w('gammaIm'),
          square: true,
          circle: 1,
          xRange: [-1.05, 1.05],
          yRange: [-1.05, 1.05],
        }}
      />
      <Note>{w('smithNote', { z0: fmt(z0) })}</Note>
      <Plot
        title={w('waveTitle')}
        spec={{
          series: [{ label: '|V|/|V⁺|', x: wave.d, y: wave.v }],
          xLabel: w('distanceAxis'),
          yLabel: '|V|/|V⁺|',
        }}
      />
      <StepList steps={[...load.steps, ...line.steps]} />
      <InsertMenu
        answer={answer}
        latex={String.raw`Z_{in} = Z_0 \frac{Z_L + j Z_0 \tan \beta l}{Z_0 + j Z_L \tan \beta l}`}
        steps={[...load.steps, ...line.steps]}
        picture={() => chart.current?.picture('smith-chart') ?? Promise.resolve(null)}
      />
    </>
  );
}

type Matching = 'lSection' | 'shuntStub' | 'seriesStub' | 'quarterWave';
const MATCH = {
  method: 'lSection' as Matching,
  z0: '50',
  zl: '200',
  frequency: '100e6',
  end: 'short' as 'open' | 'short',
  gammaMax: '0.1',
};

const elementText = (element: LElement) =>
  w(`elements.${element.kind}`, {
    value: element.kind.endsWith('L') ? fmt(element.value * 1e9, 6) : fmt(element.value * 1e12, 6),
  });

function matchResult(state: typeof MATCH) {
  const z0 = num(state.z0);
  const zl = readComplex(state.zl);
  if (state.method === 'lSection') {
    const result = lSection(zl, z0, num(state.frequency));
    if (!result.solutions.length) throw new SignalError('noMatch');
    const table: TableData = {
      header: [w('nextToLoad'), w('seriesHeader'), w('shuntHeader')],
      rows: result.solutions.map((s) => [w(`next.${s.nextToLoad}`), elementText(s.series), elementText(s.shunt)]),
    };
    return { answer: w('lAnswer', { count: result.solutions.length }), table, steps: result.steps };
  }
  if (state.method === 'quarterWave') {
    const result = quarterWave(zl.re, z0, num(state.gammaMax));
    return {
      answer: w('quarterAnswer', { z1: fmt(result.z1), band: fmt(result.bandwidth * 100, 4) }),
      table: undefined,
      steps: result.steps,
    };
  }
  const result = singleStub(zl, z0, state.method === 'shuntStub' ? 'shunt' : 'series', state.end);
  const table: TableData = {
    header: [w('stubD'), w('stubLength'), w('cancels')],
    rows: result.solutions.map((s) => [`${fmt(s.d, 5)} λ`, `${fmt(s.length, 5)} λ`, fmt(s.cancel, 5)]),
  };
  return {
    answer: w('stubAnswer', { d: fmt(result.solutions[0]!.d, 4), l: fmt(result.solutions[0]!.length, 4) }),
    table,
    steps: result.steps,
  };
}

function MatchingMode() {
  const [state, set] = useStored('rf.matching', MATCH);
  const outcome = useMemo(() => attempt(() => matchResult(state)), [state]);
  return (
    <>
      <Fields>
        <Choice
          label={w('method')}
          value={state.method}
          options={['lSection', 'shuntStub', 'seriesStub', 'quarterWave'] as const}
          name={(m) => w(`methods.${m}`)}
          onChange={(method) => set({ method })}
        />
        <Field label={w('z0')} value={state.z0} onChange={(z0) => set({ z0 })} unit="Ω" />
        <Field label={w('zl')} value={state.zl} onChange={(zl) => set({ zl })} unit="Ω" hint={w('complexHint')} />
        {state.method === 'lSection' ? (
          <Field
            label={w('frequency')}
            value={state.frequency}
            onChange={(frequency) => set({ frequency })}
            unit="Hz"
          />
        ) : null}
        {state.method === 'shuntStub' || state.method === 'seriesStub' ? (
          <Choice
            label={w('stubEnd')}
            value={state.end}
            options={['short', 'open'] as const}
            name={(e) => w(`ends.${e}`)}
            onChange={(end) => set({ end })}
          />
        ) : null}
        {state.method === 'quarterWave' ? (
          <Field label={w('gammaMax')} value={state.gammaMax} onChange={(gammaMax) => set({ gammaMax })} />
        ) : null}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={outcome.value.answer} />
          {outcome.value.table ? (
            <DataTable caption={w(`methods.${state.method}`)} table={outcome.value.table} />
          ) : null}
          <StepList steps={outcome.value.steps} />
          <InsertMenu
            answer={outcome.value.answer}
            {...(outcome.value.table ? { table: outcome.value.table } : {})}
            steps={outcome.value.steps}
            latex={
              state.method === 'quarterWave'
                ? String.raw`Z_1 = \sqrt{Z_0 R_L}`
                : String.raw`Q = \sqrt{R_{high}/R_{low} - 1}`
            }
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function LineTypesMode() {
  const [state, set] = useStored('rf.lineTypes', {
    type: 'microstrip' as LineType,
    ratio: '2',
    permittivity: '4.4',
    frequency: '1e9',
  });
  const outcome = useMemo(
    () => attempt(() => lineParameters(state.type, num(state.ratio), num(state.permittivity))),
    [state],
  );
  const frequency = num(state.frequency);
  return (
    <>
      <Fields>
        <Choice
          label={w('lineType')}
          value={state.type}
          options={['coax', 'twoWire', 'microstrip'] as const}
          name={(type) => w(`lineTypes.${type}`)}
          onChange={(type) => set({ type })}
        />
        <Field label={w(`ratios.${state.type}`)} value={state.ratio} onChange={(ratio) => set({ ratio })} />
        <Field
          label={w('permittivity')}
          value={state.permittivity}
          onChange={(permittivity) => set({ permittivity })}
        />
        <Field label={w('frequency')} value={state.frequency} onChange={(f) => set({ frequency: f })} unit="Hz" />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('lineAnswer', { z0: fmt(outcome.value.z0) })} />
          <Results
            rows={[
              [w('effective'), fmt(outcome.value.effectivePermittivity)],
              [w('velocity'), fmt(outcome.value.velocityFactor)],
              ...(frequency > 0
                ? ([[w('guideWavelength'), `${fmt((299_792_458 * outcome.value.velocityFactor) / frequency)} m`]] as [
                    string,
                    string,
                  ][])
                : []),
            ]}
          />
          {state.type === 'microstrip' ? <Note>{w('microstripSource')}</Note> : null}
          <StepList steps={outcome.value.steps} />
          <InsertMenu answer={w('lineAnswer', { z0: fmt(outcome.value.z0) })} steps={outcome.value.steps} />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

export function RfTool() {
  const [state, set] = useStored('rf', { mode: 'load' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'load' ? <LoadMode /> : null}
        {state.mode === 'matching' ? <MatchingMode /> : null}
        {state.mode === 'lineTypes' ? <LineTypesMode /> : null}
        {state.mode === 'twoPort' ? <TwoPortMode /> : null}
        {state.mode === 'noise' ? <NoiseMode /> : null}
        {state.mode === 'antenna' ? <AntennaMode /> : null}
        {state.mode === 'decibels' ? <DecibelMode /> : null}
      </Tabs>
    </div>
  );
}
