// The cam designer's form and results: a motion program typed one segment per line, the follower, and the cam's
// size and speed. It shows the peaks, the pressure angle, the curvature, the profile, and the SVAJ diagrams.
import { fail, unwrap } from '../kit/errors';
import { q } from '../kit/format';
import { readRows } from '../kit/lines';
import { num, str, type ResultRow, type ToolSpec } from '../kit/spec';
import { fromShown, type System } from '../kit/units';
import { solveCam, type CamLaw, type CamSegment, type CamSegmentKind } from './engine';

const KINDS: readonly CamSegmentKind[] = ['rise', 'dwell', 'return'];
const LAWS: Readonly<Record<string, CamLaw>> = {
  harmonic: 'harmonic',
  shm: 'harmonic',
  cycloidal: 'cycloidal',
  poly345: 'poly345',
  poly4567: 'poly4567',
};

/** Segments typed as "rise 90 25 cycloidal": the kind, degrees of cam turn, the lift, and the law. */
export function readProgram(text: string, system: System): CamSegment[] {
  return readRows(text, 1, 2).map((row, i) => {
    const kind = KINDS.find((one) => row.words.includes(one));
    const lawWord = row.words.find((word) => word in LAWS);
    const line = { line: String(i + 1) };
    if (!kind) return fail('camSegmentKind', line);
    if (kind !== 'dwell' && row.numbers.length !== 2) return fail('camSegmentNumbers', line);
    return {
      kind,
      beta: (row.numbers[0] * Math.PI) / 180,
      lift: kind === 'dwell' ? 0 : fromShown(row.numbers[1], 'small', system),
      law: lawWord ? LAWS[lawWord] : 'cycloidal',
    };
  });
}

export const camSpec: ToolSpec = {
  fields: [
    {
      id: 'program',
      type: 'text',
      rows: 5,
      first: 'rise 90 25 cycloidal\ndwell 90\nreturn 90 25 cycloidal\ndwell 90',
      hint: true,
    },
    { id: 'follower', type: 'choice', options: ['roller', 'flat'], first: 'roller' },
    { id: 'baseRadius', type: 'quantity', kind: 'small', first: '30 mm' },
    { id: 'rollerRadius', type: 'quantity', kind: 'small', first: '10 mm', when: (v) => v.follower === 'roller' },
    { id: 'offset', type: 'quantity', kind: 'small', first: '0 mm', hint: true, when: (v) => v.follower === 'roller' },
    { id: 'speed', type: 'quantity', kind: 'rpm', first: '300' },
  ],
  examples: [
    { id: 'cycloidal', values: { program: 'rise 90 25 cycloidal\ndwell 90\nreturn 90 25 cycloidal\ndwell 90' } },
    { id: 'harmonic', values: { program: 'rise 90 25 harmonic\ndwell 90\nreturn 90 25 harmonic\ndwell 90' } },
    { id: 'poly', values: { program: 'rise 120 20 poly345\ndwell 60\nreturn 120 20 poly4567\ndwell 60' } },
    { id: 'flat', values: { follower: 'flat', baseRadius: '40 mm' } },
  ],
  run(values, system) {
    const follower = str(values, 'follower') === 'flat' ? 'flat' : 'roller';
    const r = unwrap(
      solveCam({
        segments: readProgram(str(values, 'program'), system),
        follower,
        baseRadius: num(values, 'baseRadius'),
        rollerRadius: follower === 'roller' ? num(values, 'rollerRadius') : 0,
        offset: follower === 'roller' ? num(values, 'offset') : 0,
        speed: num(values, 'speed'),
      }),
    );
    const rows: ResultRow[] = [
      { id: 'lift', value: q(r.lift, 'small'), sym: 'h' },
      { id: 'vPerRad', value: q(r.peaks.v, 'small'), sym: "s'_{\\max}" },
      { id: 'aPerRad', value: q(r.peaks.a, 'small'), sym: "s''_{\\max}" },
      { id: 'jPerRad', value: q(r.peaks.j, 'small') },
      { id: 'vt', value: q(r.peaks.vt, 'velocity'), sym: 'v_{\\max}', answer: true },
      { id: 'at', value: q(r.peaks.at, 'acceleration'), sym: 'a_{\\max}', answer: true },
      { id: 'jt', value: q(r.peaks.jt, 'jerk'), sym: 'j_{\\max}' },
    ];
    if (follower === 'roller')
      rows.push(
        { id: 'pressure', value: q(Math.abs(r.pressure.max), 'angle'), sym: '\\phi_{\\max}', answer: true },
        { id: 'pressureAt', value: q(r.pressure.at, 'angle') },
      );
    rows.push(
      { id: 'curvature', value: q(r.curvature.min, 'small'), sym: '\\rho_{\\min}' },
      { id: 'curvatureAt', value: q(r.curvature.at, 'angle') },
      { id: 'undercut', word: r.curvature.undercut ? 'yes' : 'no' },
    );
    if (r.faceHalfWidth !== null) rows.push({ id: 'face', value: q(r.faceHalfWidth, 'small') });
    const notes = ['turning', follower === 'roller' ? 'roller' : 'flat', 'perRadian'];
    return { rows, steps: r.steps, notes, plots: [r.profile, ...r.svaj] };
  },
};
