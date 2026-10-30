// The deflection tool's form: E, I, and L, with the supports, loads, changes of EI, and points of interest typed one
// to a line in the shown units. The moment equation of each piece is written in those units, so a student can
// follow the integration by hand.
import { numberLatex } from '../kit/format';
import { typedLines } from '../kit/lines';
import type { KitStep } from '../kit/types';
import { fail, q, step } from '../kit/types';
import { byFirst, every, fixed, type ToolSpec, type Values } from '../kit/spec';
import { fromShown, toShown, unitOf, type Kind, type System } from '../kit/units';
import { beamDeflection, type DeflectionLoad, type MomentPiece } from './engine';
import type { BeamSupportKind } from '../../structures/beam';

const num = (values: Values, id: string) => values[id] as number;

function numbersOf(
  words: readonly string[],
  kinds: readonly Kind[],
  system: System,
  code: 'supportLine' | 'loadLine' | 'segmentLine',
  line: number,
) {
  if (words.length !== kinds.length) fail(code, String(line));
  return words.map((word, i) => {
    const value = Number(word);
    if (!Number.isFinite(value)) fail(code, String(line));
    return fromShown(value, kinds[i], system);
  });
}

const SUPPORTS: readonly BeamSupportKind[] = ['pin', 'roller', 'fixed', 'hinge'];

function readSupports(text: string, system: System) {
  const supports = typedLines(text).map(({ words, line }) => {
    const kind = words[0].toLowerCase() as BeamSupportKind;
    if (!SUPPORTS.includes(kind)) fail('supportLine', String(line));
    const [x] = numbersOf(words.slice(1), ['span'], system, 'supportLine', line);
    return { kind, x };
  });
  if (supports.length === 0) fail('unstable');
  return supports;
}

function readLoads(text: string, system: System): DeflectionLoad[] {
  return typedLines(text).map(({ words, line }) => {
    const kind = words[0].toLowerCase();
    const rest = words.slice(1);
    if (kind === 'point') {
      const [x, P] = numbersOf(rest, ['span', 'bigForce'], system, 'loadLine', line);
      return { kind: 'point', x, P };
    }
    if (kind === 'moment') {
      const [x, M] = numbersOf(rest, ['span', 'bigMoment'], system, 'loadLine', line);
      return { kind: 'moment', x, M };
    }
    if (kind === 'udl' || kind === 'dist') {
      const kinds: Kind[] = rest.length === 4 ? ['span', 'span', 'spanLoad', 'spanLoad'] : ['span', 'span', 'spanLoad'];
      const [x1, x2, w1, w2] = numbersOf(rest, kinds, system, 'loadLine', line);
      return { kind: 'udl', x1, x2, w1, w2: w2 ?? w1 };
    }
    return fail('loadLine', String(line));
  });
}

function readSegments(text: string, system: System) {
  return typedLines(text).map(({ words, line }) => {
    const [x1, x2, factor] = numbersOf(words, ['span', 'span', 'ratio'], system, 'segmentLine', line);
    return { x1, x2, factor };
  });
}

function readPoints(text: string, system: System) {
  return typedLines(text).flatMap(({ words, line }) =>
    words.map((word) => {
      const value = Number(word);
      if (!Number.isFinite(value)) fail('pointLine', String(line));
      return fromShown(value, 'span', system);
    }),
  );
}

/** The cubic of a piece as LaTeX, with x in the shown span unit and M in the shown moment unit. */
function polynomial(piece: MomentPiece, system: System): string {
  const fx = fromShown(1, 'span', system);
  const coefficients = piece.c.map((c, k) => toShown(c * fx ** k, 'bigMoment', system));
  const reach = Math.max(
    Math.abs(toShown(piece.a, 'span', system)),
    Math.abs(toShown(piece.b, 'span', system)),
    1e-300,
  );
  const size = Math.max(...coefficients.map((c, k) => Math.abs(c) * reach ** k));
  const terms: string[] = [];
  coefficients.forEach((c, k) => {
    if (Math.abs(c) * reach ** k <= 1e-9 * size || c === 0) return;
    const body = numberLatex(Math.abs(c));
    const power = ['', ' x', ' x^2', ' x^3'][k];
    const sign = c < 0 ? '-' : terms.length === 0 ? '' : '+';
    terms.push(`${sign} ${body}${power}`.trim());
  });
  return terms.length === 0 ? '0' : terms.join(' ');
}

function pieceSteps(pieces: readonly MomentPiece[], system: System): KitStep[] {
  return pieces.map((piece) =>
    step(
      piece.factor === 1 ? 'deflection.moment' : 'deflection.momentStiff',
      `M(x) = ${polynomial(piece, system)}, \\quad [[a]] \\le x \\le [[b]]`,
      {
        a: q(piece.a, 'span'),
        b: q(piece.b, 'span'),
        xu: unitOf('span', system),
        mu: unitOf('bigMoment', system),
        factor: piece.factor,
      },
    ),
  );
}

const LOAD_COLUMNS = byFirst({
  point: ['span', 'bigForce'],
  moment: ['span', 'bigMoment'],
  udl: ['span', 'span', 'spanLoad', 'spanLoad'],
  dist: ['span', 'span', 'spanLoad', 'spanLoad'],
});

export const deflectionSpec: ToolSpec = {
  fields: [
    { id: 'E', type: 'quantity', kind: 'modulus', first: '200 GPa' },
    { id: 'I', type: 'quantity', kind: 'inertia', first: '8e6 mm^4' },
    { id: 'L', type: 'quantity', kind: 'span', first: '4 m' },
    { id: 'supports', type: 'text', rows: 3, first: 'pin 0\nroller 4', columns: every('span') },
    { id: 'loads', type: 'text', rows: 3, first: 'udl 0 4 10', columns: LOAD_COLUMNS },
    { id: 'segments', type: 'text', rows: 2, first: '', columns: fixed('span', 'span', null) },
    { id: 'points', type: 'text', rows: 1, first: '1 2', columns: every('span') },
  ],
  examples: [
    { id: 'simple', values: { L: '4 m', supports: 'pin 0\nroller 4', loads: 'udl 0 4 10', segments: '' } },
    { id: 'cantilever', values: { L: '4 m', supports: 'fixed 0', loads: 'point 4 10', segments: '', points: '2 4' } },
    { id: 'propped', values: { L: '4 m', supports: 'fixed 0\nroller 4', loads: 'udl 0 4 10', segments: '' } },
    {
      id: 'continuous',
      values: { L: '8 m', supports: 'pin 0\nroller 4\nroller 8', loads: 'udl 0 8 10', segments: '', points: '4' },
    },
    {
      id: 'gerber',
      values: { L: '6 m', supports: 'fixed 0\nhinge 2\nroller 6', loads: 'point 4 20', segments: '', points: '2' },
    },
    {
      id: 'stepped',
      values: { L: '4 m', supports: 'fixed 0', loads: 'point 4 10', segments: '0 2 2', points: '2' },
    },
  ],
  run(values, system) {
    const r = beamDeflection({
      L: num(values, 'L'),
      EI: num(values, 'E') * num(values, 'I'),
      supports: readSupports(String(values.supports), system),
      loads: readLoads(String(values.loads), system),
      segments: readSegments(String(values.segments), system),
      at: readPoints(String(values.points), system),
    });
    const steps = [r.steps[0], ...pieceSteps(r.pieces, system), ...r.steps.slice(1)];
    return {
      rows: [
        { id: 'vMax', value: q(r.vMax.v, 'deflection'), sym: 'v_{max}', answer: true },
        { id: 'xMax', value: q(r.vMax.x, 'span'), sym: 'x_{max}', answer: true },
        { id: 'thetaA', value: q(r.thetaA, 'radians'), sym: '\\theta_A' },
        { id: 'thetaB', value: q(r.thetaB, 'radians'), sym: '\\theta_B' },
        { id: 'thetaMax', value: q(r.thetaMax.theta, 'radians'), sym: '\\theta_{max}' },
        { id: 'xTheta', value: q(r.thetaMax.x, 'span') },
      ],
      steps,
      tables: [
        {
          id: 'reactions',
          columns: ['support', 'x', 'R', 'M'],
          rows: r.reactions.map((one) => [
            one.kind,
            q(one.x, 'span'),
            q(one.R, 'bigForce'),
            q(one.M ?? 0, 'bigMoment'),
          ]),
        },
        ...(r.points.length === 0
          ? []
          : [
              {
                id: 'points',
                columns: ['x', 'v', 'theta', 'M'],
                rows: r.points.map((p) => [
                  q(p.x, 'span'),
                  q(p.v, 'deflection'),
                  q(p.theta, 'radians'),
                  q(p.M, 'bigMoment'),
                ]),
              },
            ]),
      ],
      notes: ['signs', 'theory', ...(r.status === 'indeterminate' ? ['indeterminate'] : []), 'superpose'],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'x', kind: 'span' },
          y: { label: 'v', kind: 'deflection' },
          series: [{ id: 'curve', points: r.curve }],
          marks: [{ x: r.vMax.x, y: r.vMax.v, id: 'max' }],
        },
      },
    };
  },
};
