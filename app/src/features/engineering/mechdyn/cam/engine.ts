// Cam design. A follower motion program is a list of rise, dwell, and return segments, each with a standard law
// (simple harmonic, cycloidal, or the 3-4-5 and 4-5-6-7 polynomials). The engine gives displacement, velocity,
// acceleration, and jerk (SVAJ) per radian and per second. It cuts the profile for a translating roller (radial or
// offset) or flat-faced follower, with the pressure angle and the radius of curvature. The cam turns
// counterclockwise; a positive offset moves the follower axis to the right of the cam center. SI inside: lengths in
// m, angles in rad.
import { tex } from '../tex';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';

export type CamLaw = 'harmonic' | 'cycloidal' | 'poly345' | 'poly4567';
export type CamSegmentKind = 'rise' | 'dwell' | 'return';

export interface CamSegment {
  kind: CamSegmentKind;
  /** Cam angle the segment lasts, rad. */
  beta: number;
  /** Lift for a rise or return, m. */
  lift: number;
  law: CamLaw;
}

export interface CamInput {
  segments: CamSegment[];
  follower: 'roller' | 'flat';
  /** Base circle radius of the cam surface, m. */
  baseRadius: number;
  rollerRadius: number;
  offset: number;
  /** Cam speed, rad/s. */
  speed: number;
}

export const CAM_DEFAULTS: CamInput = {
  segments: [
    { kind: 'rise', beta: Math.PI / 2, lift: 0.025, law: 'cycloidal' },
    { kind: 'dwell', beta: Math.PI / 2, lift: 0, law: 'cycloidal' },
    { kind: 'return', beta: Math.PI / 2, lift: 0.025, law: 'cycloidal' },
    { kind: 'dwell', beta: Math.PI / 2, lift: 0, law: 'cycloidal' },
  ],
  follower: 'roller',
  baseRadius: 0.03,
  rollerRadius: 0.01,
  offset: 0,
  speed: (2 * Math.PI * 300) / 60,
};

const PI = Math.PI;

/** Normalized law at x in [0, 1]: s/h and its derivatives in x (multiply by h/beta^n for per-radian values). */
export function camLaw(law: CamLaw, x: number): [number, number, number, number] {
  switch (law) {
    case 'harmonic':
      return [
        (1 - Math.cos(PI * x)) / 2,
        (PI / 2) * Math.sin(PI * x),
        (PI ** 2 / 2) * Math.cos(PI * x),
        -(PI ** 3 / 2) * Math.sin(PI * x),
      ];
    case 'cycloidal':
      return [
        x - Math.sin(2 * PI * x) / (2 * PI),
        1 - Math.cos(2 * PI * x),
        2 * PI * Math.sin(2 * PI * x),
        4 * PI ** 2 * Math.cos(2 * PI * x),
      ];
    case 'poly345':
      return [
        10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5,
        30 * x ** 2 - 60 * x ** 3 + 30 * x ** 4,
        60 * x - 180 * x ** 2 + 120 * x ** 3,
        60 - 360 * x + 360 * x ** 2,
      ];
    case 'poly4567':
      return [
        35 * x ** 4 - 84 * x ** 5 + 70 * x ** 6 - 20 * x ** 7,
        140 * x ** 3 - 420 * x ** 4 + 420 * x ** 5 - 140 * x ** 6,
        420 * x ** 2 - 1680 * x ** 3 + 2100 * x ** 4 - 840 * x ** 5,
        840 * x - 5040 * x ** 2 + 8400 * x ** 3 - 4200 * x ** 4,
      ];
  }
}

/** The LaTeX of each law's displacement, for the worked steps. */
const LAW_LATEX: Record<CamLaw, string> = {
  harmonic:
    's = \\frac h2\\left(1 - \\cos\\frac{\\pi\\theta}{\\beta}\\right),' +
    '\\quad v_{\\max} = \\frac{\\pi h}{2\\beta},\\quad a_{\\max} = \\frac{\\pi^2 h}{2\\beta^2}',
  cycloidal:
    's = h\\left(\\frac\\theta\\beta - \\frac{1}{2\\pi}\\sin\\frac{2\\pi\\theta}{\\beta}\\right),' +
    '\\quad v_{\\max} = \\frac{2h}{\\beta},\\quad a_{\\max} = \\frac{2\\pi h}{\\beta^2}',
  poly345:
    's = h\\left(10x^3 - 15x^4 + 6x^5\\right),\\ x = \\frac\\theta\\beta,' +
    '\\quad v_{\\max} = \\frac{1.875h}{\\beta},\\quad a_{\\max} = \\frac{5.7735h}{\\beta^2}',
  poly4567:
    's = h\\left(35x^4 - 84x^5 + 70x^6 - 20x^7\\right),\\ x = \\frac\\theta\\beta,' +
    '\\quad v_{\\max} = \\frac{2.1875h}{\\beta},\\quad a_{\\max} = \\frac{7.5132h}{\\beta^2}',
};

export interface CamPoint {
  theta: number;
  s: number;
  v: number;
  a: number;
  j: number;
}

export interface CamResult {
  lift: number;
  /** Largest magnitudes per radian (m/rad, m/rad^2, m/rad^3) and per second. */
  peaks: { v: number; a: number; j: number; vt: number; at: number; jt: number };
  /** Largest pressure angle magnitude and where, rad (0 for a flat-faced follower). */
  pressure: { max: number; at: number };
  /** Smallest radius of curvature of the cam surface where it is convex, m, and where. */
  curvature: { min: number; at: number; undercut: boolean };
  /** Flat-faced follower: the face must reach this far each side of the stem, m. */
  faceHalfWidth: number | null;
  svaj: Plot[];
  profile: Plot;
  steps: MechStep[];
}

/** Follower displacement and its derivatives per radian at cam angle theta, from the segment list. */
export function camMotion(segments: readonly CamSegment[], theta: number): CamPoint {
  let start = 0;
  let base = 0;
  const angle = ((theta % (2 * PI)) + 2 * PI) % (2 * PI);
  for (const seg of segments) {
    const end = start + seg.beta;
    if (angle < end || seg === segments[segments.length - 1]) {
      const x = Math.min(1, Math.max(0, (angle - start) / seg.beta));
      if (seg.kind === 'dwell') return { theta, s: base, v: 0, a: 0, j: 0 };
      const [s, v, a, j] = camLaw(seg.law, x);
      const h = seg.lift,
        b = seg.beta;
      const sign = seg.kind === 'rise' ? 1 : -1;
      return {
        theta,
        s: seg.kind === 'rise' ? base + h * s : base - h * s,
        v: (sign * h * v) / b,
        a: (sign * h * a) / b ** 2,
        j: (sign * h * j) / b ** 3,
      };
    }
    base += seg.kind === 'rise' ? seg.lift : seg.kind === 'return' ? -seg.lift : 0;
    start = end;
  }
  return { theta, s: 0, v: 0, a: 0, j: 0 };
}

/** Checks the motion program; the largest lift, or why it can't be cut. */
function checkProgram(input: CamInput): Outcome<number> {
  const { segments, follower, baseRadius: Rb, rollerRadius: Rf, offset: e, speed: w } = input;
  if (!finite(Rb, Rf, e, w, ...segments.flatMap((s) => [s.beta, s.lift]))) return fail('notNumber');
  if (segments.length === 0) return fail('camNoSegments');
  if (segments.some((s) => s.beta <= 0)) return fail('camSegmentAngle');
  if (segments.some((s) => s.kind !== 'dwell' && s.lift <= 0)) return fail('camLift');
  const total = segments.reduce((sum, s) => sum + s.beta, 0);
  if (Math.abs(total - 2 * PI) > 1e-6) return fail('camCycle', { total: fmt((total * 180) / PI, 6) });
  let height = 0;
  let lift = 0;
  for (const s of segments) {
    height += s.kind === 'rise' ? s.lift : s.kind === 'return' ? -s.lift : 0;
    if (height < -1e-12) return fail('camBelowBase');
    lift = Math.max(lift, height);
  }
  if (Math.abs(height) > 1e-9) return fail('camReturn');
  if (Rb <= 0) return fail('positiveRadius');
  if (follower === 'roller' && Rf <= 0) return fail('positiveRadius');
  if (follower === 'roller' && Math.abs(e) >= Rb + Rf) return fail('camOffset');
  return { ok: true, value: lift };
}

/** Peak velocity, acceleration, and jerk per radian, sampled on each segment's own grid so its ends land. */
function peakRates(segments: readonly CamSegment[]): { v: number; a: number; j: number } {
  let v = 0;
  let a = 0;
  let j = 0;
  for (const seg of segments) {
    if (seg.kind === 'dwell') continue;
    for (let i = 0; i <= 2000; i += 1) {
      const [, dv, da, dj] = camLaw(seg.law, i / 2000);
      v = Math.max(v, (seg.lift * Math.abs(dv)) / seg.beta);
      a = Math.max(a, (seg.lift * Math.abs(da)) / seg.beta ** 2);
      j = Math.max(j, (seg.lift * Math.abs(dj)) / seg.beta ** 3);
    }
  }
  return { v, a, j };
}

interface Sweep {
  pts: CamPoint[];
  pitch: [number, number][];
  surface: [number, number][];
  pmax: number;
  pAt: number;
  rhoMin: number;
  rhoAt: number;
  face: number;
}

const rotate = (x: number, y: number, th: number): [number, number] => [
  x * Math.cos(th) + y * Math.sin(th),
  -x * Math.sin(th) + y * Math.cos(th),
];

/** One turn of the cam, finely sampled: the pressure angle, the curvature, and the profile. */
function sweep(input: CamInput): Sweep {
  const { segments, follower, baseRadius: Rb, rollerRadius: Rf, offset: e } = input;
  const Rp = follower === 'roller' ? Rb + Rf : Rb;
  const d = follower === 'roller' ? Math.sqrt(Rp * Rp - e * e) : Rb;
  const out: Sweep = { pts: [], pitch: [], surface: [], pmax: 0, pAt: 0, rhoMin: Infinity, rhoAt: 0, face: 0 };
  const N = 7200;
  for (let i = 0; i <= N; i += 1) {
    const th = (2 * PI * i) / N;
    const p = camMotion(segments, th);
    const keep = i % 10 === 0;
    if (keep) out.pts.push(p);
    if (follower === 'flat') {
      const rho = Rb + p.s + p.a;
      if (rho < out.rhoMin) [out.rhoMin, out.rhoAt] = [rho, th];
      out.face = Math.max(out.face, Math.abs(p.v));
      if (keep) out.surface.push(rotate(p.v, Rb + p.s, th));
      continue;
    }
    const phi = Math.atan((p.v - e) / (d + p.s));
    if (Math.abs(phi) > Math.abs(out.pmax)) [out.pmax, out.pAt] = [phi, th];
    // Pitch curve tangent u and second derivative w in the follower frame; rho > 0 where convex.
    const u: [number, number] = [d + p.s, p.v - e];
    const wv: [number, number] = [2 * p.v - e, p.a - d - p.s];
    const rhoPitch = -(Math.hypot(...u) ** 3) / (u[0] * wv[1] - u[1] * wv[0]);
    if (rhoPitch > 0 && rhoPitch - Rf < out.rhoMin) [out.rhoMin, out.rhoAt] = [rhoPitch - Rf, th];
    if (keep) {
      out.pitch.push(rotate(e, d + p.s, th));
      const n = Math.hypot(u[0], u[1]);
      out.surface.push(rotate(e - (Rf * -(p.v - e)) / n, d + p.s - (Rf * (d + p.s)) / n, th));
    }
  }
  return out;
}

const deg = (r: number) => (r * 180) / PI;

/** The laws used, the peaks, the pressure angle, and the curvature, as worked steps. */
function camSteps(input: CamInput, peaks: { v: number; a: number; j: number }, s: Sweep): MechStep[] {
  const { segments, follower, baseRadius: Rb, rollerRadius: Rf, speed: w } = input;
  const steps: MechStep[] = [];
  const laws = [...new Set(segments.filter((one) => one.kind !== 'dwell').map((one) => one.law))];
  for (const law of laws) steps.push({ key: `camLaw_${law}`, math: LAW_LATEX[law] });
  steps.push({
    key: 'camPeaks',
    math:
      `v_{\\max} = ${tex(peaks.v * 1000)}\\ \\mathrm{mm/rad},\\ a_{\\max} = ${tex(peaks.a * 1000)}\\ \\mathrm{mm/rad^2},` +
      `\\ j_{\\max} = ${tex(peaks.j * 1000)}\\ \\mathrm{mm/rad^3}`,
  });
  steps.push({
    key: 'camPerSecond',
    math:
      `\\dot s = \\omega\\,\\frac{ds}{d\\theta}:\\ ${tex(peaks.v * w)}\\ \\mathrm{m/s},\\quad ` +
      `\\ddot s = \\omega^2\\frac{d^2s}{d\\theta^2}:\\ ${tex(peaks.a * w * w)}\\ \\mathrm{m/s^2}`,
  });
  const undercut = s.rhoMin <= 0;
  const curve = { rho: fmt(s.rhoMin * 1000, 4), at: fmt(deg(s.rhoAt), 4) };
  if (follower === 'flat') {
    steps.push({ key: 'camFlatPressure' });
    steps.push({ key: undercut ? 'camCusp' : 'camFlatCurvature', vars: curve, math: `\\rho = R_b + s + s''` });
    steps.push({ key: 'camFaceWidth', vars: { width: fmt(s.face * 1000, 4) }, math: `x_\\text{contact} = s'` });
    return steps;
  }
  steps.push({
    key: 'camPressure',
    vars: { angle: fmt(deg(Math.abs(s.pmax)), 4), at: fmt(deg(s.pAt), 4) },
    math: `\\phi = \\arctan\\frac{s' - e}{\\sqrt{R_p^2 - e^2} + s},\\quad R_p = R_b + R_f = ${tex((Rb + Rf) * 1000)}\\ \\mathrm{mm}`,
  });
  if (Math.abs(s.pmax) > (30 * PI) / 180) steps.push({ key: 'camPressureHigh' });
  steps.push({
    key: undercut ? 'camUndercut' : 'camCurvature',
    vars: curve,
    math: `\\rho_\\text{cam} = \\rho_\\text{pitch} - R_f`,
  });
  return steps;
}

export function solveCam(input: CamInput): Outcome<CamResult> {
  const checked = checkProgram(input);
  if (!checked.ok) return checked;
  const { follower, baseRadius: Rb, speed: w } = input;
  const peaks = peakRates(input.segments);
  const s = sweep(input);
  const svajPlot = (y: 'camS' | 'camV' | 'camA' | 'camJ', pick: (p: CamPoint) => number): Plot => ({
    x: 'camAngle',
    y,
    series: [{ name: y, points: s.pts.map((p) => [deg(p.theta), pick(p)] as [number, number]) }],
  });
  const circle = (r: number): [number, number][] =>
    Array.from({ length: 181 }, (_, i) => [r * Math.cos((2 * PI * i) / 180), r * Math.sin((2 * PI * i) / 180)]);
  return {
    ok: true,
    value: {
      lift: checked.value,
      peaks: { ...peaks, vt: peaks.v * w, at: peaks.a * w * w, jt: peaks.j * w ** 3 },
      pressure: { max: follower === 'roller' ? s.pmax : 0, at: s.pAt },
      curvature: { min: s.rhoMin, at: s.rhoAt, undercut: s.rhoMin <= 0 },
      faceHalfWidth: follower === 'flat' ? s.face : null,
      svaj: [
        svajPlot('camS', (p) => p.s),
        svajPlot('camV', (p) => p.v),
        svajPlot('camA', (p) => p.a),
        svajPlot('camJ', (p) => p.j),
      ],
      profile: {
        x: 'x',
        y: 'y',
        equal: true,
        series: [
          { name: 'camProfile', points: s.surface },
          ...(follower === 'roller' ? [{ name: 'pitchCurve' as const, points: s.pitch }] : []),
          { name: 'baseCircle', points: circle(Rb) },
        ],
      },
      steps: camSteps(input, peaks, s),
    },
  };
}

/** Pressure angle of a translating roller follower at one cam angle, rad. */
export function pressureAngleAt(input: CamInput, theta: number): number {
  const Rp = input.baseRadius + input.rollerRadius;
  const p = camMotion(input.segments, theta);
  return Math.atan((p.v - input.offset) / (Math.sqrt(Rp * Rp - input.offset ** 2) + p.s));
}
