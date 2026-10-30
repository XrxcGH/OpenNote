// The section tool's form: a library shape with its dimensions, a typed list of rectangles and circles (holes
// allowed), or a thin-walled centerline. An optional cut height adds Q there; Q at the centroid is always shown.
import type { DrawContext } from '../kit/picture';
import { every, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { q } from '../kit/types';
import { fromShown, type System } from '../kit/units';
import { sectionSvg } from './draw';
import { firstMoment, sectionProperties, shearCenter, type Placed } from './engine';
import { readChain, readParts, shapeParts, wallParts, SHAPES, type Built, type Shape } from './shapes';

const num = (values: Values, id: string) => values[id] as number;
const among =
  (...shapes: string[]) =>
  (v: Values) =>
    shapes.includes(v.shape as string);

function build(values: Values, system: System): Built {
  const shape = values.shape as string;
  const toSi = (value: number) => fromShown(value, 'length', system);
  if (shape === 'parts') return { parts: readParts(String(values.parts), toSi) };
  if (shape === 'thin') {
    const chain = readChain(String(values.points), num(values, 't'), toSi);
    const [first, last] = [chain[0], chain[chain.length - 1]];
    const closed = Math.hypot(first.x1 - last.x2, first.y1 - last.y2) < 1e-12;
    return { parts: wallParts(chain), ...(closed ? {} : { chain }) };
  }
  const dims = {
    b: num(values, 'b'),
    h: num(values, 'h'),
    d: num(values, 'd'),
    t: num(values, 't'),
    tf: num(values, 'tf'),
    tw: num(values, 'tw'),
  };
  return shapeParts(shape as Shape, dims);
}

function center(built: Built, centroid: { x: number; y: number }) {
  if (built.chain) return shearCenter(built.chain);
  if (built.center === 'centroid') return { ...centroid, steps: [] };
  if (built.center) return { ...built.center, steps: [] };
  return null;
}

export const sectionsSpec: ToolSpec = {
  fields: [
    { id: 'shape', type: 'choice', options: [...SHAPES, 'parts', 'thin'], first: 'T' },
    { id: 'b', type: 'quantity', kind: 'length', first: '100 mm', when: among('rect', 'I', 'T', 'C', 'L', 'Z', 'box') },
    { id: 'h', type: 'quantity', kind: 'length', first: '120 mm', when: among('rect', 'I', 'T', 'C', 'L', 'Z', 'box') },
    { id: 'd', type: 'quantity', kind: 'length', first: '50 mm', when: among('circle', 'tube') },
    { id: 'tf', type: 'quantity', kind: 'length', first: '20 mm', when: among('I', 'T', 'C', 'Z') },
    { id: 'tw', type: 'quantity', kind: 'length', first: '20 mm', when: among('I', 'T', 'C', 'Z') },
    { id: 't', type: 'quantity', kind: 'length', first: '5 mm', when: among('tube', 'L', 'box', 'thin') },
    {
      id: 'parts',
      type: 'text',
      rows: 5,
      first: 'rect 100 20 50 110\nrect 20 100 50 50',
      columns: every('length'),
      when: among('parts'),
    },
    {
      id: 'points',
      type: 'text',
      rows: 5,
      first: '50 100\n0 100\n0 0\n50 0',
      columns: every('length'),
      when: among('thin'),
    },
    { id: 'cut', type: 'quantity', kind: 'length', first: '', optional: true },
  ],
  examples: [
    { id: 'tee', values: { shape: 'T', b: '100 mm', h: '120 mm', tf: '20 mm', tw: '20 mm' } },
    { id: 'channel', values: { shape: 'thin', t: '2 mm', points: '50 100\n0 100\n0 0\n50 0' } },
    { id: 'zed', values: { shape: 'thin', t: '5 mm', points: '50 50\n0 50\n0 -50\n-50 -50' } },
    { id: 'plate', values: { shape: 'parts', parts: 'rect 200 100 0 0\nhole circle 40 50 0', cut: '20 mm' } },
  ],
  run(values, system) {
    const built = build(values, system);
    const r = sectionProperties(built.parts);
    const centroid = { x: r.xBar, y: r.yBar };
    const na = firstMoment(built.parts, r.yBar, r.yBar);
    const cutGiven = Number.isFinite(num(values, 'cut'));
    const atCut = cutGiven ? firstMoment(built.parts, num(values, 'cut'), r.yBar) : null;
    const sc = center(built, centroid);
    const rows: ResultRow[] = [
      { id: 'A', value: q(r.A, 'area'), sym: 'A', answer: true },
      { id: 'xBar', value: q(r.xBar, 'length'), sym: '\\bar x' },
      { id: 'yBar', value: q(r.yBar, 'length'), sym: '\\bar y', answer: true },
      { id: 'Ix', value: q(r.Ix, 'inertia'), sym: 'I_x', answer: true },
      { id: 'Iy', value: q(r.Iy, 'inertia'), sym: 'I_y', answer: true },
      { id: 'Ixy', value: q(r.Ixy, 'inertia'), sym: 'I_{xy}' },
      { id: 'I1', value: q(r.I1, 'inertia'), sym: 'I_1' },
      { id: 'I2', value: q(r.I2, 'inertia'), sym: 'I_2' },
      { id: 'thetaP', value: q(r.thetaP, 'angle'), sym: '\\theta_p' },
      { id: 'rx', value: q(r.rx, 'length'), sym: 'r_x' },
      { id: 'ry', value: q(r.ry, 'length'), sym: 'r_y' },
      { id: 'Stop', value: q(r.Stop, 'volume'), sym: 'S_{x,top}' },
      { id: 'Sbottom', value: q(r.Sbottom, 'volume'), sym: 'S_{x,bottom}' },
      { id: 'Sright', value: q(r.Sright, 'volume'), sym: 'S_{y,right}' },
      { id: 'Sleft', value: q(r.Sleft, 'volume'), sym: 'S_{y,left}' },
      { id: 'Qna', value: q(na.Q, 'volume'), sym: 'Q_{NA}' },
      { id: 'tNa', value: q(na.width, 'length'), sym: 't_{NA}' },
    ];
    if (na.below !== na.above)
      rows.push({ id: 'tNaBelow', value: q(na.below, 'length') }, { id: 'tNaAbove', value: q(na.above, 'length') });
    if (atCut)
      rows.push(
        { id: 'Qcut', value: q(atCut.Q, 'volume'), sym: 'Q' },
        { id: 'tCut', value: q(atCut.width, 'length'), sym: 't' },
        ...(atCut.below === atCut.above
          ? []
          : [
              { id: 'tBelow', value: q(atCut.below, 'length') },
              { id: 'tAbove', value: q(atCut.above, 'length') },
            ]),
      );
    if (sc)
      rows.push({ id: 'xS', value: q(sc.x, 'length'), sym: 'x_S' }, { id: 'yS', value: q(sc.y, 'length'), sym: 'y_S' });
    const steps = [...r.steps];
    steps.push(
      {
        key: 'sections.radius',
        math: 'r_x = \\sqrt{I_x/A} = [[rx]], \\quad r_y = \\sqrt{I_y/A} = [[ry]]',
        vars: { rx: q(r.rx, 'length'), ry: q(r.ry, 'length') },
      },
      {
        key: 'sections.modulus',
        math: 'S_{x} = \\frac{I_x}{c} = [[St]]\\ \\text{(top)},\\ [[Sb]]\\ \\text{(bottom)}',
        vars: { St: q(r.Stop, 'volume'), Sb: q(r.Sbottom, 'volume') },
      },
      {
        key: 'sections.firstMoment',
        math: "Q = \\sum A' \\bar y' = [[Q]]",
        vars: { Q: q(atCut ? atCut.Q : na.Q, 'volume'), at: q(atCut ? num(values, 'cut') : r.yBar, 'length') },
      },
      ...(sc?.steps ?? []),
    );
    const notes = ['axes', values.shape === 'thin' ? 'thin' : 'origin', 'Q'];
    if (built.chain) notes.push('shear');
    if (values.shape === 'thin' && !built.chain) notes.push('closed');
    if (values.shape === 'parts') notes.push('noShear');
    if (na.below !== na.above || (atCut && atCut.below !== atCut.above)) notes.push('edge');
    const labels = built.parts.map((_, i) => String(i + 1));
    return {
      rows,
      steps,
      tables: [
        {
          id: 'own',
          columns: ['part', 'A', 'x', 'y', 'Ix', 'Iy', 'Ixy'],
          rows: r.ownTable.map((row, i) => [labels[i], ...row]),
        },
        {
          id: 'transfer',
          columns: ['part', 'Ady2', 'Adx2', 'Adxdy'],
          rows: r.transferTable.map((row, i) => [labels[i], ...row]),
        },
      ],
      notes,
      picture: {
        type: 'draw',
        draw: (ctx: DrawContext) =>
          sectionSvg(
            {
              parts: built.parts as Placed[],
              extent: r.extent,
              centroid,
              thetaP: r.thetaP,
              ...(sc ? { shear: { x: sc.x, y: sc.y } } : {}),
              ...(cutGiven ? { cut: num(values, 'cut') } : {}),
            },
            ctx,
          ),
      },
    };
  },
};
