// Complex analysis: a value in both forms, roots on a circle, poles and residues with contour integrals checked two
// ways, real integrals by residues, and the image of a grid under a conformal map.
import { t } from '../../../../strings/t';
import { fmt } from '../numeric';
import { KitError } from '../types';
import styles from '../ui/mathkit.module.css';
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
import { cauchyRiemann, laurent } from './analytic';
import { evaluateTree, formatC, latexC, readComplex, type C } from './cmath';
import {
  MAPS,
  contourIntegral,
  evaluateValue,
  improperIntegral,
  mapGrid,
  nthRoots,
  trigIntegral,
  type Contour,
  type MapName,
} from './engine';

type Mode = 'value' | 'roots' | 'residues' | 'real' | 'map' | 'analytic' | 'laurent';

const FIRST = {
  mode: 'value' as Mode,
  value: '(1+i)^8',
  rootOf: '-8',
  rootCount: '3',
  fn: 'e^z/(z-1)',
  contour: 'circle',
  center: '0',
  radius: '2',
  points: '-1-i; 1-i; 1+i; -1+i',
  realKind: 'line',
  realLine: '1/(1+x^2)',
  realTrig: '1/(2+cos(t))',
  map: 'square' as MapName,
  region: '-1, 1, -1, 1',
  crFn: 'z^2',
  crRegion: '-2, 2, -2, 2',
  laurentFn: 'exp(1/z)',
  laurentCenter: '0',
  laurentRadius: '1',
  laurentOrder: '5',
};

type State = typeof FIRST;
type Patch = (patch: Partial<State>) => void;

const MAP_LABEL = {
  square: 'kitMath.complex.mapSquare',
  inverse: 'kitMath.complex.mapInverse',
  exp: 'kitMath.complex.mapExp',
  mobius: 'kitMath.complex.mapMobius',
  joukowski: 'kitMath.complex.mapJoukowski',
  sin: 'kitMath.complex.mapSin',
} as const;

const complexOf = (text: string): C => {
  const value = evaluateTree(readComplex(text, []), {});
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) throw new KitError('unreadable', text);
  return value;
};

function contourOf(state: State): Contour {
  if (state.contour === 'circle') {
    const radius = Number(state.radius);
    if (!(radius > 0)) throw new KitError('badContour');
    return { kind: 'circle', center: complexOf(state.center), radius };
  }
  return { kind: 'polygon', points: state.points.split(';').map(complexOf) };
}

function run(state: State) {
  switch (state.mode) {
    case 'value':
      return { kind: 'value' as const, out: evaluateValue(state.value) };
    case 'roots':
      return { kind: 'roots' as const, out: nthRoots(state.rootOf, Number(state.rootCount)) };
    case 'residues':
      return { kind: 'contour' as const, out: contourIntegral(state.fn, contourOf(state)) };
    case 'real':
      return state.realKind === 'line'
        ? { kind: 'real' as const, out: improperIntegral(state.realLine) }
        : { kind: 'real' as const, out: trigIntegral(state.realTrig) };
    case 'analytic':
      return {
        kind: 'analytic' as const,
        out: cauchyRiemann(
          state.crFn,
          state.crRegion.split(',').map((part) => Number(part.trim())),
        ),
      };
    case 'laurent':
      return {
        kind: 'laurent' as const,
        out: laurent(state.laurentFn, state.laurentCenter, Number(state.laurentRadius), Number(state.laurentOrder)),
      };
    default: {
      const [x0, x1, y0, y1] = state.region.split(',').map((part) => Number(part.trim()));
      return { kind: 'map' as const, out: mapGrid(state.map, x0, x1, y0, y1) };
    }
  }
}

type Run = ReturnType<typeof run>;

function ResidueFields({ state, set }: { state: State; set: Patch }) {
  return (
    <>
      <TextInput wide label={t('kitMath.complex.expressionZ')} value={state.fn} onChange={(fn) => set({ fn })} />
      <div className={styles.row}>
        <Choice
          label={t('kitMath.complex.contour')}
          value={state.contour as 'circle' | 'polygon'}
          options={[
            { value: 'circle', label: t('kitMath.complex.contourCircle') },
            { value: 'polygon', label: t('kitMath.complex.contourPolygon') },
          ]}
          onChange={(contour) => set({ contour })}
        />
        {state.contour === 'circle' ? (
          <>
            <TextInput
              label={t('kitMath.complex.center')}
              value={state.center}
              onChange={(center) => set({ center })}
            />
            <TextInput
              label={t('kitMath.complex.radius')}
              value={state.radius}
              onChange={(radius) => set({ radius })}
            />
          </>
        ) : (
          <TextInput
            wide
            label={t('kitMath.complex.points')}
            value={state.points}
            onChange={(points) => set({ points })}
          />
        )}
      </div>
    </>
  );
}

function RealFields({ state, set }: { state: State; set: Patch }) {
  const line = state.realKind === 'line';
  return (
    <>
      <Choice
        label={t('kitMath.complex.realKind')}
        value={state.realKind as 'line' | 'trig'}
        options={[
          { value: 'line', label: t('kitMath.complex.realLine') },
          { value: 'trig', label: t('kitMath.complex.realTrig') },
        ]}
        onChange={(realKind) => set({ realKind })}
      />
      <TextInput
        wide
        label={line ? t('kitMath.complex.expressionX') : t('kitMath.complex.expressionT')}
        value={line ? state.realLine : state.realTrig}
        onChange={(text) => set(line ? { realLine: text } : { realTrig: text })}
      />
    </>
  );
}

function AnalyticFields({ state, set }: { state: State; set: Patch }) {
  return (
    <div className={styles.row}>
      <TextInput wide label={t('kitMath.complex.expressionZ')} value={state.crFn} onChange={(crFn) => set({ crFn })} />
      <TextInput
        label={t('kitMath.complex.crRegion')}
        value={state.crRegion}
        onChange={(crRegion) => set({ crRegion })}
      />
    </div>
  );
}

function LaurentFields({ state, set }: { state: State; set: Patch }) {
  return (
    <>
      <TextInput
        wide
        label={t('kitMath.complex.expressionZ')}
        value={state.laurentFn}
        onChange={(laurentFn) => set({ laurentFn })}
      />
      <div className={styles.row}>
        <TextInput
          label={t('kitMath.complex.laurentCenter')}
          value={state.laurentCenter}
          onChange={(laurentCenter) => set({ laurentCenter })}
        />
        <TextInput
          label={t('kitMath.complex.laurentRadius')}
          value={state.laurentRadius}
          onChange={(laurentRadius) => set({ laurentRadius })}
        />
        <TextInput
          label={t('kitMath.complex.laurentOrder')}
          value={state.laurentOrder}
          onChange={(laurentOrder) => set({ laurentOrder })}
        />
      </div>
    </>
  );
}

function Fields({ state, set }: { state: State; set: Patch }) {
  if (state.mode === 'value') {
    return (
      <TextInput
        wide
        label={t('kitMath.complex.expression')}
        value={state.value}
        onChange={(value) => set({ value })}
      />
    );
  }
  if (state.mode === 'roots') {
    return (
      <div className={styles.row}>
        <TextInput
          label={t('kitMath.complex.expression')}
          value={state.rootOf}
          onChange={(rootOf) => set({ rootOf })}
        />
        <TextInput
          label={t('kitMath.complex.rootCount')}
          value={state.rootCount}
          onChange={(rootCount) => set({ rootCount })}
        />
      </div>
    );
  }
  if (state.mode === 'residues') return <ResidueFields state={state} set={set} />;
  if (state.mode === 'real') return <RealFields state={state} set={set} />;
  if (state.mode === 'analytic') return <AnalyticFields state={state} set={set} />;
  if (state.mode === 'laurent') return <LaurentFields state={state} set={set} />;
  return (
    <div className={styles.row}>
      <Choice
        label={t('kitMath.complex.map')}
        value={state.map}
        options={MAPS.map((name) => ({ value: name, label: t(MAP_LABEL[name]) }))}
        onChange={(map) => set({ map })}
      />
      <TextInput label={t('kitMath.complex.region')} value={state.region} onChange={(region) => set({ region })} />
    </div>
  );
}

export default function ComplexTool() {
  const [state, set] = useStored('complex', FIRST);
  const { result, problem } = useSolved({ ...state }, run);
  return (
    <div className={styles.panel}>
      <Choice
        label={t('kitMath.complex.mode')}
        value={state.mode}
        options={[
          { value: 'value', label: t('kitMath.complex.modeValue') },
          { value: 'roots', label: t('kitMath.complex.modeRoots') },
          { value: 'residues', label: t('kitMath.complex.modeResidues') },
          { value: 'real', label: t('kitMath.complex.modeReal') },
          { value: 'map', label: t('kitMath.complex.modeMap') },
          { value: 'analytic', label: t('kitMath.complex.modeAnalytic') },
          { value: 'laurent', label: t('kitMath.complex.modeLaurent') },
        ]}
        onChange={(mode) => set({ mode })}
      />
      <Fields state={state} set={set} />
      <Note>{t('kitMath.complex.assumptions')}</Note>
      <Note>{t('kitMath.complex.hint')}</Note>
      <Problem text={problem} />
      {result ? <Output result={result} /> : null}
    </div>
  );
}

function ValueOutput({ out }: { out: Extract<Run, { kind: 'value' }>['out'] }) {
  const answer = t('kitMath.complex.rect', { value: out.rect });
  const polar = t('kitMath.complex.polar', { modulus: fmt(out.modulus, 10), argument: fmt(out.argument, 10) });
  const log = out.principalLog ? `\n${t('kitMath.complex.log', { value: formatC(out.principalLog, 10) })}` : '';
  return (
    <>
      <Result>{`${answer}\n${polar}${log}`}</Result>
      <Steps steps={out.steps} />
      <InsertBar answer={answer} latex={latexC(out.value, 10)} steps={out.steps} />
    </>
  );
}

function RootsOutput({ out }: { out: Extract<Run, { kind: 'roots' }>['out'] }) {
  const { roots, steps } = out;
  const size = Math.max(...roots.map((r) => Math.hypot(r.re, r.im)));
  const ring = Array.from({ length: 121 }, (_, k): [number, number] => [
    size * Math.cos((2 * Math.PI * k) / 120),
    size * Math.sin((2 * Math.PI * k) / 120),
  ]);
  const list = roots.map((r) => formatC(r, 10));
  return (
    <>
      <Result>{list.join('\n')}</Result>
      <LinePlot
        equal
        label={t('kitMath.complex.plotRoots')}
        series={[
          { points: ring, tone: 5 },
          { points: roots.map((r): [number, number] => [r.re, r.im]), dots: true },
        ]}
      />
      <Steps steps={steps} />
      <InsertBar
        answer={list.join(', ')}
        table={{ header: ['k', 'root'], rows: list.map((root, k) => [String(k), root]) }}
        steps={steps}
      />
    </>
  );
}

function ContourOutput({ out }: { out: Extract<Run, { kind: 'contour' }>['out'] }) {
  const answer = t('kitMath.complex.byResidues', { value: formatC(out.value, 10) });
  const latex = `\\oint f\\,dz=${latexC(out.value, 10)}`;
  return (
    <>
      <Result>{`${answer}\n${t('kitMath.complex.byQuadrature', { value: formatC(out.numeric, 10) })}`}</Result>
      <MathView latex={latex} />
      {out.disagree ? <Note>{t('kitMath.complex.disagree')}</Note> : null}
      {out.inside.map((p, k) => (
        <Note key={k}>
          {t('kitMath.complex.poleRow', { at: formatC(p.at, 8), order: p.order, residue: formatC(p.residue, 10) })}
        </Note>
      ))}
      <Steps steps={out.steps} />
      <InsertBar answer={answer} latex={latex} steps={out.steps} />
    </>
  );
}

function RealOutput({ out }: { out: Extract<Run, { kind: 'real' }>['out'] }) {
  const answer = t('kitMath.complex.value', { value: fmt(out.value, 10) });
  return (
    <>
      <Result>{`${answer}\n${t('kitMath.complex.check', { value: fmt(out.numeric, 10) })}`}</Result>
      <Steps steps={out.steps} />
      <InsertBar answer={answer} latex={`${out.integral}=${fmt(out.value, 10)}`} steps={out.steps} />
    </>
  );
}

function AnalyticOutput({ out }: { out: Extract<Run, { kind: 'analytic' }>['out'] }) {
  const yes = t('kitMath.complex.crYes');
  const no = t('kitMath.complex.crNo');
  const header = t('kitMath.complex.crHeader').split(', ');
  const rows = out.rows.map((r) => [
    fmt(r.x, 4),
    fmt(r.y, 4),
    fmt(r.ux, 6),
    fmt(r.vy, 6),
    fmt(r.uy, 6),
    fmt(-r.vx, 6),
    r.holds ? yes : no,
  ]);
  const answer = t(out.analytic ? 'kitMath.complex.crAnalytic' : 'kitMath.complex.crNotAnalytic');
  return (
    <>
      <Result>{answer}</Result>
      {out.derivative ? <Note>{t('kitMath.complex.crDerivative', { value: formatC(out.derivative, 8) })}</Note> : null}
      <table className={styles.table} aria-label={t('kitMath.complex.crTable')}>
        <thead>
          <tr>
            {header.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Steps steps={out.steps} />
      <InsertBar answer={answer} table={{ header, rows }} steps={out.steps} />
    </>
  );
}

function LaurentOutput({ out }: { out: Extract<Run, { kind: 'laurent' }>['out'] }) {
  const header = t('kitMath.complex.laurentHeader').split(', ');
  const rows = out.coefficients.map((p) => [String(p.k), formatC(p.a, 8)]);
  const answer = t('kitMath.complex.laurentResidue', { value: formatC(out.residue, 10) });
  const latex = `f(z)=${out.series}`;
  return (
    <>
      <Result>{answer}</Result>
      <Note>{t('kitMath.complex.laurentPrincipal')}</Note>
      <MathView latex={out.principal} />
      {out.steady ? null : <Note>{t('kitMath.complex.laurentUnsteady')}</Note>}
      <Steps steps={out.steps} />
      <InsertBar answer={answer} latex={latex} table={{ header, rows }} steps={out.steps} />
    </>
  );
}

function Output({ result }: { result: Run }) {
  if (result.kind === 'analytic') return <AnalyticOutput out={result.out} />;
  if (result.kind === 'laurent') return <LaurentOutput out={result.out} />;
  if (result.kind === 'value') return <ValueOutput out={result.out} />;
  if (result.kind === 'roots') return <RootsOutput out={result.out} />;
  if (result.kind === 'contour') return <ContourOutput out={result.out} />;
  if (result.kind === 'real') return <RealOutput out={result.out} />;
  const { lines, count } = result.out;
  return (
    <LinePlot
      equal
      label={t('kitMath.complex.plotMap')}
      series={lines.map((points, k) => ({ points, tone: k < count ? 0 : 1 }))}
    />
  );
}
