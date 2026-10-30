// The waves and sound tool's calculations: a string, a pipe, the Doppler effect, beats, two waves together, and
// sound levels.
import { deg, q } from '../kit/format';
import { fail } from '../kit/read';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, ResultRow, ToolSpec } from '../kit/types';
import { sub } from '../kit/symbols';
import {
  I_REF,
  beatFrequency,
  beatSamples,
  doppler,
  intensityOf,
  pipeModes,
  pointIntensity,
  soundLevel,
  stringWave,
  superpose,
} from './engine';

const superposeMode: ModeDef = {
  id: 'superpose',
  label: 'kitPhysics.waves.modes.superpose',
  fields: [
    { id: 'a1', label: 'kitPhysics.waves.f.a1', initial: '1' },
    { id: 'a2', label: 'kitPhysics.waves.f.a2', initial: '1' },
    { id: 'phi', label: 'kitPhysics.waves.f.phase', dim: 'angle', initial: '60' },
  ],
  solve(read): Outcome {
    const a1 = read.num('a1', 'nonNegative');
    const a2 = read.num('a2', 'nonNegative');
    const phi = read.num('phi');
    if (a1 === 0 && a2 === 0) fail('kitPhysics.waves.errors.zeroAmplitude');
    const sum = superpose(a1, a2, phi);
    const wave = (a: number, shift: number) =>
      Array.from({ length: 241 }, (_, i): [number, number] => [i / 120, a * Math.cos(2 * Math.PI * (i / 120) + shift)]);
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.waves.r.amplitude', symbol: 'A', value: sum.amplitude, primary: true },
        { key: 'kitPhysics.waves.r.resultPhase', symbol: 'δ', value: sum.phase, dim: 'angle' },
        { key: 'kitPhysics.waves.r.kind', value: '', word: `kitPhysics.waves.kind.${sum.kind}` },
      ],
      latex: 'A=\\sqrt{A_1^2+A_2^2+2A_1A_2\\cos\\varphi}',
      steps: [
        { key: 'kitPhysics.waves.s.amplitude', vars: { A: q(sum.amplitude, ''), phi: q(deg(phi), '°') } },
        { key: 'kitPhysics.waves.s.resultPhase', vars: { delta: q(deg(sum.phase), '°') } },
      ],
      notes: [{ key: 'kitPhysics.waves.notes.superpose' }],
      plot: {
        frame: 'axes',
        alt: { key: 'kitPhysics.waves.plot.superpose' },
        x: { label: 't / T' },
        y: { label: 'y' },
        series: [
          { points: wave(a1, 0), tone: 'second', dash: true },
          { points: wave(a2, phi), tone: 'third', dash: true },
          { points: wave(sum.amplitude, sum.phase), tone: 'accent', width: 2 },
        ],
        legend: [
          { tone: 'second', key: 'kitPhysics.waves.legend.first', dash: true },
          { tone: 'third', key: 'kitPhysics.waves.legend.second', dash: true },
          { tone: 'accent', key: 'kitPhysics.waves.legend.sum' },
        ],
      },
    };
  },
};

const count = (read: Reader, id: string) => {
  const n = read.num(id, { min: 1, max: 20 });
  if (!Number.isInteger(n))
    fail('kitPhysics.errors.range', { min: '1', max: '20' }, { field: 'kitPhysics.waves.f.count' });
  return n;
};

function standingPlot(length: number, modes: number, closed: boolean): Plot {
  const series = [];
  for (let n = 1; n <= Math.min(modes, 3); n++) {
    const k = closed ? ((2 * n - 1) * Math.PI) / (2 * length) : (n * Math.PI) / length;
    const points: [number, number][] = Array.from({ length: 121 }, (_, i) => {
      const x = (length * i) / 120;
      return [x, (closed ? Math.cos(k * x) : Math.sin(k * x)) * 0.9 + 3 - n * 2.2];
    });
    const tone = (['accent', 'second', 'third'] as const)[n - 1];
    series.push(
      { points, tone },
      { points: points.map(([x, y]) => [x, 2 * (3 - n * 2.2) - y] as [number, number]), tone, dash: true },
    );
  }
  return {
    frame: 'axes',
    alt: {
      key: closed ? 'kitPhysics.waves.plot.pipe' : 'kitPhysics.waves.plot.string',
      vars: { count: String(Math.min(modes, 3)) },
    },
    x: { label: 'x (m)' },
    y: { label: 'n = 1, 2, 3' },
    series,
  };
}

const stringMode: ModeDef = {
  id: 'string',
  label: 'kitPhysics.waves.modes.string',
  fields: [
    { id: 'T', label: 'kitPhysics.waves.f.tension', dim: 'force', initial: '70' },
    {
      id: 'mu',
      label: 'kitPhysics.waves.f.density',
      dim: 'linearDensity',
      unit: 'g/m',
      usUnit: 'lb/ft',
      initial: '0.5',
    },
    { id: 'L', label: 'kitPhysics.waves.f.length', dim: 'length', initial: '0.65' },
    { id: 'n', label: 'kitPhysics.waves.f.count', initial: '5' },
  ],
  solve(read): Outcome {
    const T = read.num('T', 'positive');
    const mu = read.num('mu', 'positive');
    const L = read.num('L', 'positive');
    const wave = stringWave(T, mu, L, count(read, 'n'));
    const [first] = wave.harmonics;
    const rows: ResultRow[] = [
      { key: 'kitPhysics.waves.r.speed', symbol: 'v', value: wave.speed, dim: 'speed', primary: true },
      ...wave.harmonics.map((h) => ({
        key: 'kitPhysics.waves.r.harmonic' as const,
        symbol: `f${sub(h.n)}`,
        value: h.f,
        dim: 'frequency' as const,
        primary: h.n === 1,
      })),
      { key: 'kitPhysics.waves.r.wavelength', symbol: 'λ₁', value: first.wavelength, dim: 'length' },
    ];
    return {
      ok: true,
      rows,
      latex: 'v=\\sqrt{\\frac{T}{\\mu}},\\qquad f_n=\\frac{n\\,v}{2L}',
      steps: [
        { key: 'kitPhysics.waves.s.speed', vars: { T: q(T, 'N'), mu: q(mu, 'kg/m'), v: q(wave.speed, 'm/s') } },
        {
          key: 'kitPhysics.waves.s.fundamental',
          vars: { v: q(wave.speed, 'm/s'), L: q(L, 'm'), f1: q(first.f, 'Hz') },
        },
        { key: 'kitPhysics.waves.s.harmonics', vars: { lambda: q(first.wavelength, 'm') } },
      ],
      notes: [{ key: 'kitPhysics.waves.notes.string' }],
      plot: standingPlot(L, wave.harmonics.length, false),
    };
  },
};

const pipeMode: ModeDef = {
  id: 'pipe',
  label: 'kitPhysics.waves.modes.pipe',
  fields: [
    { id: 'L', label: 'kitPhysics.waves.f.pipeLength', dim: 'length', initial: '0.5' },
    { id: 'v', label: 'kitPhysics.waves.f.sound', dim: 'speed', initial: '343' },
    {
      id: 'ends',
      label: 'kitPhysics.waves.f.ends',
      kind: 'choice',
      initial: 'closed',
      options: [
        { value: 'closed', label: 'kitPhysics.waves.o.closed' },
        { value: 'open', label: 'kitPhysics.waves.o.open' },
      ],
    },
    { id: 'n', label: 'kitPhysics.waves.f.count', initial: '5' },
  ],
  solve(read): Outcome {
    const L = read.num('L', 'positive');
    const v = read.num('v', 'positive');
    const ends = read.choice('ends') === 'open' ? 'open' : 'closed';
    const modes = pipeModes(L, v, ends, count(read, 'n'));
    return {
      ok: true,
      rows: [
        ...modes.map((m, i) => ({
          key: 'kitPhysics.waves.r.harmonic' as const,
          symbol: `f${sub(m.n)}`,
          value: m.f,
          dim: 'frequency' as const,
          primary: i === 0,
        })),
        { key: 'kitPhysics.waves.r.wavelength', symbol: 'λ₁', value: modes[0].wavelength, dim: 'length' },
      ],
      latex: ends === 'open' ? 'f_n=\\frac{n\\,v}{2L},\\ n=1,2,3,\\ldots' : 'f_n=\\frac{n\\,v}{4L},\\ n=1,3,5,\\ldots',
      steps: [
        {
          key: ends === 'open' ? 'kitPhysics.waves.s.pipeOpen' : 'kitPhysics.waves.s.pipeClosed',
          vars: { v: q(v, 'm/s'), L: q(L, 'm'), f1: q(modes[0].f, 'Hz') },
        },
        { key: 'kitPhysics.waves.s.pipeList', vars: { list: modes.map((m) => q(m.f, 'Hz')).join(', ') } },
      ],
      notes: [
        { key: ends === 'open' ? 'kitPhysics.waves.notes.open' : 'kitPhysics.waves.notes.closed' },
        { key: 'kitPhysics.waves.notes.endCorrection' },
      ],
      plot: standingPlot(L, modes.length, ends === 'closed'),
    };
  },
};

const motion = (id: string, label: 'kitPhysics.waves.f.sourceMotion' | 'kitPhysics.waves.f.observerMotion') => ({
  id,
  label,
  kind: 'choice' as const,
  initial: 'toward',
  options: [
    { value: 'toward', label: 'kitPhysics.waves.o.toward' as const },
    { value: 'away', label: 'kitPhysics.waves.o.away' as const },
  ],
});

const dopplerMode: ModeDef = {
  id: 'doppler',
  label: 'kitPhysics.waves.modes.doppler',
  fields: [
    { id: 'f', label: 'kitPhysics.waves.f.frequency', dim: 'frequency', initial: '500' },
    { id: 'v', label: 'kitPhysics.waves.f.sound', dim: 'speed', initial: '343' },
    { id: 'vs', label: 'kitPhysics.waves.f.sourceSpeed', dim: 'speed', initial: '30' },
    motion('sm', 'kitPhysics.waves.f.sourceMotion'),
    { id: 'vo', label: 'kitPhysics.waves.f.observerSpeed', dim: 'speed', initial: '0' },
    motion('om', 'kitPhysics.waves.f.observerMotion'),
  ],
  solve(read): Outcome {
    const f = read.num('f', 'positive');
    const v = read.num('v', 'positive');
    const vs = read.num('vs', 'nonNegative') * (read.choice('sm') === 'away' ? -1 : 1);
    const vo = read.num('vo', 'nonNegative') * (read.choice('om') === 'away' ? -1 : 1);
    const heard = doppler(f, v, vs, vo);
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.waves.r.heard', symbol: 'f′', value: heard, dim: 'frequency', primary: true },
        { key: 'kitPhysics.waves.r.shift', symbol: 'Δf', value: heard - f, dim: 'frequency' },
        { key: 'kitPhysics.waves.r.ratio', symbol: 'f′/f', value: heard / f },
      ],
      latex: "f'=f\\,\\frac{v+v_o}{v-v_s}",
      steps: [
        { key: 'kitPhysics.waves.s.dopplerSigns', vars: { vs: q(vs, 'm/s'), vo: q(vo, 'm/s') } },
        {
          key: 'kitPhysics.waves.s.doppler',
          vars: { f: q(f, 'Hz'), v: q(v, 'm/s'), vo: q(vo, 'm/s'), vs: q(vs, 'm/s'), heard: q(heard, 'Hz') },
        },
      ],
      notes: [{ key: 'kitPhysics.waves.notes.doppler' }],
    };
  },
};

const beatsMode: ModeDef = {
  id: 'beats',
  label: 'kitPhysics.waves.modes.beats',
  fields: [
    { id: 'f1', label: 'kitPhysics.waves.f.f1', dim: 'frequency', initial: '440' },
    { id: 'f2', label: 'kitPhysics.waves.f.f2', dim: 'frequency', initial: '444' },
  ],
  solve(read): Outcome {
    const f1 = read.num('f1', 'positive');
    const f2 = read.num('f2', 'positive');
    const beat = beatFrequency(f1, f2);
    const span = beat > 0 ? 2 / beat : 10 / f1;
    const samples = Math.min(4000, Math.max(600, Math.ceil(span * Math.max(f1, f2) * 12)));
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.waves.r.beat', symbol: 'f_beat', value: beat, dim: 'frequency', primary: true },
        { key: 'kitPhysics.waves.r.average', symbol: 'f_avg', value: (f1 + f2) / 2, dim: 'frequency' },
        ...(beat > 0
          ? [{ key: 'kitPhysics.waves.r.beatPeriod' as const, symbol: 'T_beat', value: 1 / beat, dim: 'time' as const }]
          : []),
      ],
      latex: 'f_\\text{beat}=\\lvert f_1-f_2\\rvert',
      steps: [
        { key: 'kitPhysics.waves.s.beat', vars: { f1: q(f1, 'Hz'), f2: q(f2, 'Hz'), beat: q(beat, 'Hz') } },
        { key: 'kitPhysics.waves.s.average', vars: { avg: q((f1 + f2) / 2, 'Hz') } },
      ],
      plot: {
        frame: 'axes',
        alt: { key: 'kitPhysics.waves.plot.beats' },
        x: { label: 't (s)' },
        y: { label: 'y₁ + y₂' },
        series: [{ points: beatSamples(f1, f2, span, samples), width: 1 }],
      },
    };
  },
};

const levelMode: ModeDef = {
  id: 'level',
  label: 'kitPhysics.waves.modes.level',
  fields: [
    {
      id: 'given',
      label: 'kitPhysics.waves.f.given',
      kind: 'choice',
      initial: 'intensity',
      options: [
        { value: 'intensity', label: 'kitPhysics.waves.o.fromIntensity' },
        { value: 'level', label: 'kitPhysics.waves.o.fromLevel' },
        { value: 'source', label: 'kitPhysics.waves.o.fromSource' },
      ],
    },
    {
      id: 'I',
      label: 'kitPhysics.waves.f.intensity',
      dim: 'intensity',
      initial: '1e-5',
      when: (c) => c('given') === 'intensity',
    },
    { id: 'beta', label: 'kitPhysics.waves.f.level', initial: '70', when: (c) => c('given') === 'level' },
    { id: 'P', label: 'kitPhysics.waves.f.power', dim: 'power', initial: '1', when: (c) => c('given') === 'source' },
    {
      id: 'r',
      label: 'kitPhysics.waves.f.distance',
      dim: 'length',
      initial: '10',
      when: (c) => c('given') === 'source',
    },
  ],
  solve(read): Outcome {
    const given = read.choice('given');
    const steps: KitStep[] = [];
    let I: number;
    if (given === 'level') {
      const beta = read.num('beta');
      I = intensityOf(beta);
      steps.push({ key: 'kitPhysics.waves.s.fromLevel' as const, vars: { beta: q(beta, 'dB'), I: q(I, 'W/m²') } });
    } else {
      if (given === 'source') {
        const P = read.num('P', 'positive');
        const r = read.num('r', 'positive');
        I = pointIntensity(P, r);
        steps.push({
          key: 'kitPhysics.waves.s.source' as const,
          vars: { P: q(P, 'W'), r: q(r, 'm'), I: q(I, 'W/m²') },
        });
      } else I = read.num('I', 'positive');
      steps.push({ key: 'kitPhysics.waves.s.level' as const, vars: { I: q(I, 'W/m²'), beta: q(soundLevel(I), 'dB') } });
    }
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.waves.r.level', symbol: 'β', value: soundLevel(I), unit: 'dB', primary: true },
        {
          key: 'kitPhysics.waves.r.intensity',
          symbol: 'I',
          value: I,
          dim: 'intensity',
          primary: given !== 'intensity',
        },
        { key: 'kitPhysics.waves.r.reference', symbol: 'I₀', value: I_REF, dim: 'intensity' },
      ],
      latex: '\\beta=10\\log_{10}\\frac{I}{I_0},\\qquad I_0=10^{-12}\\ \\mathrm{W/m^2}',
      steps,
      notes: given === 'source' ? [{ key: 'kitPhysics.waves.notes.source' }] : [],
    };
  },
};

export const WAVES: ToolSpec = {
  id: 'waves',
  modes: [stringMode, pipeMode, dopplerMode, beatsMode, superposeMode, levelMode],
};
