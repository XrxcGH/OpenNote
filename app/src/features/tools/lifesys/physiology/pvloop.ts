// The left ventricle as a time-varying elastance: P = E(t)(V − V0), with E rising from Emin to Emax over systole as
// a half sine. Blood fills from a left atrium at fixed pressure through the mitral valve and ejects through the
// aortic valve into a two-element Windkessel (compliance C, peripheral resistance Rs); the valves are ideal diodes
// with small resistances. The model beats until it settles and reports the last beat's pressure-volume loop.
// Pressures in mmHg, volumes in mL, resistances in mmHg·s/mL, compliance in mL/mmHg, time in s.
import { LsError, positive, whole } from '../num/errors';
import { dopri } from '../num/ode';
import type { CalcResult, ResultRow, Step } from '../types';

type Point = [number, number];

export interface PvParams {
  /** Heart rate, beats/min. */
  hr: number;
  /** Duration of systole (the elastance rise and fall), s. */
  ts: number;
  /** End-systolic elastance (slope of the ESPVR), mmHg/mL. */
  emax: number;
  /** Diastolic elastance (slope of the linear EDPVR), mmHg/mL. */
  emin: number;
  /** Unstressed volume, mL. */
  v0: number;
  /** Left atrial (filling) pressure, mmHg. */
  pla: number;
  rmv: number;
  rao: number;
  rs: number;
  c: number;
  beats: number;
}

/** 1 mmHg·mL in joules. */
export const MMHG_ML_J = 133.322e-6;

/** The activation 0 to 1 at time t: a half sine over systole, 0 in diastole. */
export function activation(t: number, period: number, ts: number): number {
  const tn = t - Math.floor(t / period) * period;
  return tn < ts ? Math.sin((Math.PI * tn) / ts) : 0;
}

/** The area inside a closed loop of (x, y) points, by the shoelace formula. */
export function loopArea(points: readonly (readonly [number, number])[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

export interface PvBeat {
  t: number[];
  v: number[];
  pv: number[];
  pa: number[];
  edv: number;
  esv: number;
  /** Ventricular pressure when the volume is least. */
  esp: number;
  peak: number;
  sbp: number;
  dbp: number;
  /** Stroke work: the loop's area, mmHg·mL. */
  work: number;
}

function check(p: PvParams): number {
  positive(p.hr, 'HR');
  positive(p.ts, 'Ts');
  positive(p.emax, 'Emax');
  positive(p.emin, 'Emin');
  positive(p.pla, 'PLA');
  positive(p.rmv, 'Rmv');
  positive(p.rao, 'Rao');
  positive(p.rs, 'Rs');
  positive(p.c, 'C');
  whole(p.beats, 'n', 1);
  if (p.beats > 200) throw new LsError('physiology.e.beats', { max: 200 });
  if (!(p.v0 >= 0)) throw new LsError('physiology.e.v0');
  if (!(p.emax > p.emin)) throw new LsError('physiology.e.elastance');
  const period = 60 / p.hr;
  if (!(p.ts < period)) throw new LsError('physiology.e.systole', { T: period });
  return period;
}

/** Beats the model from a full ventricle and an aortic pressure of 80 mmHg; returns the last beat. */
export function simulatePv(p: PvParams): PvBeat {
  const period = check(p);
  const pressure = (t: number, v: number) => (p.emin + (p.emax - p.emin) * activation(t, period, p.ts)) * (v - p.v0);
  const rhs = (t: number, [v, pa]: readonly number[]) => {
    const pv = pressure(t, v);
    const inflow = p.pla > pv ? (p.pla - pv) / p.rmv : 0;
    const outflow = pv > pa ? (pv - pa) / p.rao : 0;
    return [inflow - outflow, (outflow - pa / p.rs) / p.c];
  };
  let y = [p.v0 + p.pla / p.emin, 80];
  const last: { t: number[]; y: number[][] } = { t: [], y: [] };
  // Each beat is two pieces, so the kink where systole ends falls on a step boundary.
  for (let k = 0; k < p.beats; k += 1) {
    const start = k * period;
    const pieces: [number, number][] = [
      [start, start + p.ts],
      [start + p.ts, start + period],
    ];
    for (const [a, b] of pieces) {
      const sol = dopri(rhs, y, a, b, { rtol: 1e-8, atol: 1e-8, maxStep: Math.min(1e-3, (b - a) / 200) });
      y = sol.y[sol.y.length - 1];
      if (k === p.beats - 1) {
        const from = last.t.length === 0 ? 0 : 1;
        last.t.push(...sol.t.slice(from));
        last.y.push(...sol.y.slice(from));
      }
    }
  }
  if (last.y.some((row) => row.some((value) => !Number.isFinite(value)))) throw new LsError('errors.ode');
  const v = last.y.map((row) => row[0]);
  const pa = last.y.map((row) => row[1]);
  const pv = last.t.map((t, i) => pressure(t, v[i]));
  let iMin = 0;
  v.forEach((value, i) => {
    if (value < v[iMin]) iMin = i;
  });
  // The beat's first and last points are the same state, so the loop closes without repeating it.
  const loop = v.slice(0, -1).map((value, i) => [value, pv[i]] as Point);
  return {
    t: last.t.map((t) => t - last.t[0]),
    v,
    pv,
    pa,
    edv: Math.max(...v),
    esv: v[iMin],
    esp: pv[iMin],
    peak: Math.max(...pv),
    sbp: Math.max(...pa),
    dbp: Math.min(...pa),
    work: loopArea(loop),
  };
}

export function pvLoopResult(p: PvParams): CalcResult {
  const beat = simulatePv(p);
  const sv = beat.edv - beat.esv;
  if (!(sv > 1e-6)) throw new LsError('physiology.e.noEjection');
  const ef = (100 * sv) / beat.edv;
  const co = (sv * p.hr) / 1000;
  const ea = beat.esp / sv;
  const rows: ResultRow[] = [
    { label: 'physiology.r.edv', value: beat.edv, unit: 'mL' },
    { label: 'physiology.r.esv', value: beat.esv, unit: 'mL' },
    { label: 'physiology.r.sv', value: sv, unit: 'mL' },
    { label: 'physiology.r.ef', value: ef, unit: '%' },
    { label: 'physiology.r.co', value: co, unit: 'L/min' },
    { label: 'physiology.r.peakLv', value: beat.peak, unit: 'mmHg' },
    { label: 'physiology.r.aortic', value: `${beat.sbp.toPrecision(4)}/${beat.dbp.toPrecision(4)}`, unit: 'mmHg' },
    { label: 'physiology.r.work', value: beat.work, unit: 'mmHg·mL' },
    { label: 'physiology.r.workJ', value: beat.work * MMHG_ML_J, unit: 'J' },
    { label: 'physiology.r.ea', value: ea, unit: 'mmHg/mL' },
  ];
  const steps: Step[] = [
    {
      key: 'physiology.s.elastance',
      vars: { emin: p.emin, emax: p.emax, v0: p.v0, ts: p.ts, T: 60 / p.hr },
      math: 'P(t) = E(t)\\,(V - V_0),\\quad E(t) = E_{min} + (E_{max} - E_{min})\\sin\\frac{\\pi t}{T_s}',
    },
    { key: 'physiology.s.pvBeats', vars: { n: p.beats } },
    { key: 'physiology.s.pvVolumes', vars: { edv: beat.edv, esv: beat.esv, sv, ef } },
    { key: 'physiology.s.pvWork', vars: { w: beat.work, j: beat.work * MMHG_ML_J } },
    { key: 'physiology.s.pvEa', vars: { esp: beat.esp, sv, ea, ees: p.emax, ratio: p.emax / ea } },
  ];
  const vMax = beat.edv * 1.1;
  const line = (e: number): Point[] => [
    [p.v0, 0],
    [vMax, e * (vMax - p.v0)],
  ];
  const espvrTop = Math.min(p.emax * (vMax - p.v0), beat.peak * 1.3);
  return {
    rows,
    steps,
    latex: 'P(t) = E(t)\\,(V - V_0)',
    notes: [{ key: 'physiology.n.pvLoop' }],
    source: 'physiology.src.elastance',
    plots: [
      {
        title: 'physiology.p.pvLoop',
        x: { label: 'physiology.p.volume', min: 0 },
        y: { label: 'physiology.p.pressure', min: 0 },
        series: [
          { name: 'physiology.p.loop', points: beat.v.map((value, i) => [value, beat.pv[i]] as Point) },
          {
            name: 'physiology.p.espvr',
            style: 'dashed',
            points: [
              [p.v0, 0],
              [p.v0 + espvrTop / p.emax, espvrTop],
            ],
          },
          { name: 'physiology.p.edpvr', style: 'outline', points: line(p.emin) },
        ],
      },
      {
        title: 'physiology.p.pvTime',
        x: { label: 'physiology.p.seconds', min: 0 },
        y: { label: 'physiology.p.pressure', min: 0 },
        series: [
          { name: 'physiology.p.lv', points: beat.t.map((t, i) => [t, beat.pv[i]] as Point) },
          { name: 'physiology.p.aorta', style: 'dashed', points: beat.t.map((t, i) => [t, beat.pa[i]] as Point) },
        ],
      },
    ],
  };
}

/**
 * Ventricular-arterial coupling with lines for the ESPVR (slope Ees through V0) and the arterial elastance Ea: the
 * end-systolic point satisfies both ESP = Ees (ESV − V0) and ESP = Ea × SV, so SV = Ees (EDV − V0) / (Ees + Ea).
 */
export function couplingResult(ees: number, v0: number, edv: number, ea: number): CalcResult {
  positive(ees, 'Ees');
  positive(ea, 'Ea');
  positive(edv, 'EDV');
  if (!(v0 >= 0)) throw new LsError('physiology.e.v0');
  if (!(edv > v0)) throw new LsError('physiology.e.edvV0');
  const sv = (ees * (edv - v0)) / (ees + ea);
  const esv = edv - sv;
  const esp = ea * sv;
  const ef = (100 * sv) / edv;
  const pe = (esp * (esv - v0)) / 2;
  const rows: ResultRow[] = [
    { label: 'physiology.r.sv', value: sv, unit: 'mL' },
    { label: 'physiology.r.esv', value: esv, unit: 'mL' },
    { label: 'physiology.r.esp', value: esp, unit: 'mmHg' },
    { label: 'physiology.r.ef', value: ef, unit: '%' },
    { label: 'physiology.r.ratio', value: ees / ea },
    { label: 'physiology.r.pe', value: pe, unit: 'mmHg·mL' },
  ];
  const steps: Step[] = [
    {
      key: 'physiology.s.coupling',
      vars: { ees, ea, edv, v0, sv },
      math: 'SV = \\frac{E_{es}(EDV - V_0)}{E_{es} + E_a}',
    },
    { key: 'physiology.s.couplingEnd', vars: { edv, sv, esv, ea, esp, ef } },
    { key: 'physiology.s.pe', vars: { esp, esv, v0, pe } },
  ];
  const top = Math.max(esp * 1.3, 1);
  return {
    rows,
    steps,
    latex: 'SV = \\frac{E_{es}(EDV - V_0)}{E_{es} + E_a}',
    notes: [{ key: 'physiology.n.coupling' }],
    plots: [
      {
        title: 'physiology.p.coupling',
        x: { label: 'physiology.p.volume', min: 0 },
        y: { label: 'physiology.p.pressure', min: 0 },
        series: [
          {
            name: 'physiology.p.espvr',
            points: [
              [v0, 0],
              [v0 + top / ees, top],
            ],
          },
          {
            name: 'physiology.p.eaLine',
            style: 'dashed',
            points: [
              [edv, 0],
              [Math.max(edv - top / ea, 0), Math.min(top, ea * edv)],
            ],
          },
          { name: 'physiology.p.endSystole', style: 'points', points: [[esv, esp]] },
        ],
      },
    ],
  };
}
