// Stratigraphic columns: units listed from the top down, each with a thickness, a rock, a grain size, and a base
// contact. Rock patterns follow the conventions of the FGDC Digital Cartographic Standard for Geologic Map
// Symbolization: dots for sand, dashes for shale, and bricks for limestone. Columns split by a line of three dashes
// are correlated by units that share a name.
import type { Figure, Mark, Pattern } from '../core/figure';
import { readNumber } from '../core/format';
import { check, Problem } from '../core/problem';

export const LITHOLOGIES = [
  'sandstone',
  'siltstone',
  'shale',
  'mudstone',
  'conglomerate',
  'breccia',
  'limestone',
  'dolomite',
  'chert',
  'coal',
  'evaporite',
  'tuff',
  'volcanic',
  'plutonic',
  'metamorphic',
  'cover',
] as const;
export type Lithology = (typeof LITHOLOGIES)[number];

export const GRAINS = ['clay', 'silt', 'vf', 'f', 'm', 'c', 'vc', 'granule', 'pebble', 'cobble', 'boulder'] as const;
export type Grain = (typeof GRAINS)[number];

export const CONTACTS = ['sharp', 'gradational', 'erosional', 'unconformity'] as const;
export type Contact = (typeof CONTACTS)[number];

export interface Unit {
  name: string;
  thickness: number;
  lithology: Lithology;
  grain: Grain;
  contact: Contact;
  note: string;
  line: number;
}

const ALIASES: Record<string, Lithology> = {
  sand: 'sandstone',
  silt: 'siltstone',
  clay: 'mudstone',
  claystone: 'mudstone',
  mud: 'mudstone',
  gravel: 'conglomerate',
  lime: 'limestone',
  chalk: 'limestone',
  marl: 'mudstone',
  gypsum: 'evaporite',
  salt: 'evaporite',
  basalt: 'volcanic',
  andesite: 'volcanic',
  lava: 'volcanic',
  granite: 'plutonic',
  schist: 'metamorphic',
  gneiss: 'metamorphic',
  soil: 'cover',
};

/** Reads columns of units, one per line: name, thickness, lithology, grain size, base contact, note. */
export function parseColumns(text: string): Unit[][] {
  const columns: Unit[][] = [[]];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (/^-{3,}$/.test(line)) {
      columns.push([]);
      return;
    }
    const cells = line.split(/\s*[,;\t]\s*/);
    check(cells.length >= 3, 'unitShort', { line: i + 1 });
    const thickness = readNumber(cells[1]);
    if (thickness === null || !(thickness > 0)) throw new Problem('thickness', { line: i + 1 });
    const word = cells[2].toLowerCase();
    const lithology = (LITHOLOGIES as readonly string[]).includes(word) ? (word as Lithology) : ALIASES[word];
    if (!lithology) throw new Problem('lithology', { line: i + 1, word: cells[2] });
    const grainWord = (cells[3] ?? '').toLowerCase();
    const grain = (GRAINS as readonly string[]).includes(grainWord) ? (grainWord as Grain) : defaultGrain(lithology);
    const contactWord = (cells[4] ?? '').toLowerCase();
    const contact = (CONTACTS as readonly string[]).includes(contactWord) ? (contactWord as Contact) : 'sharp';
    columns[columns.length - 1].push({
      name: cells[0],
      thickness,
      lithology,
      grain,
      contact,
      note: cells.slice(5).join(', '),
      line: i + 1,
    });
  });
  const filled = columns.filter((c) => c.length > 0);
  check(filled.length > 0, 'noUnits');
  return filled;
}

function defaultGrain(lithology: Lithology): Grain {
  switch (lithology) {
    case 'sandstone':
      return 'm';
    case 'siltstone':
      return 'silt';
    case 'conglomerate':
    case 'breccia':
      return 'pebble';
    default:
      return 'clay';
  }
}

/** Patterns for each lithology, each a small repeating tile. */
export const PATTERNS: readonly Pattern[] = [
  {
    id: 'sandstone',
    size: 8,
    marks: [
      { kind: 'circle', cx: 2, cy: 2, r: 0.8, role: 'text', fill: true },
      { kind: 'circle', cx: 6, cy: 6, r: 0.8, role: 'text', fill: true },
    ],
  },
  {
    id: 'siltstone',
    size: 8,
    marks: [
      { kind: 'line', x1: 0, y1: 2, x2: 4, y2: 2, role: 'text', width: 0.8 },
      { kind: 'circle', cx: 6, cy: 6, r: 0.6, role: 'text', fill: true },
    ],
  },
  {
    id: 'shale',
    size: 8,
    marks: [
      { kind: 'line', x1: 0, y1: 2, x2: 5, y2: 2, role: 'text', width: 0.8 },
      { kind: 'line', x1: 4, y1: 6, x2: 9, y2: 6, role: 'text', width: 0.8 },
    ],
  },
  { id: 'mudstone', size: 8, marks: [{ kind: 'line', x1: 0, y1: 4, x2: 8, y2: 4, role: 'text', width: 0.6 }] },
  {
    id: 'conglomerate',
    size: 12,
    marks: [
      { kind: 'circle', cx: 3, cy: 3, r: 2, role: 'text', width: 0.8 },
      { kind: 'circle', cx: 9, cy: 9, r: 2.4, role: 'text', width: 0.8 },
    ],
  },
  {
    id: 'breccia',
    size: 12,
    marks: [
      { kind: 'path', d: 'M1 5L4 1L6 5Z', role: 'text', width: 0.8 },
      { kind: 'path', d: 'M7 11L10 7L11 11Z', role: 'text', width: 0.8 },
    ],
  },
  {
    id: 'limestone',
    size: 12,
    marks: [
      { kind: 'line', x1: 0, y1: 0.5, x2: 12, y2: 0.5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 0, y1: 6.5, x2: 12, y2: 6.5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 3, y1: 0.5, x2: 3, y2: 6.5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 9, y1: 6.5, x2: 9, y2: 12.5, role: 'text', width: 0.8 },
    ],
  },
  {
    id: 'dolomite',
    size: 12,
    marks: [
      { kind: 'line', x1: 0, y1: 0.5, x2: 12, y2: 0.5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 0, y1: 6.5, x2: 12, y2: 6.5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 2, y1: 0.5, x2: 4, y2: 6.5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 8, y1: 6.5, x2: 10, y2: 12.5, role: 'text', width: 0.8 },
    ],
  },
  { id: 'chert', size: 10, marks: [{ kind: 'path', d: 'M2 7L5 3L8 7', role: 'text', width: 0.8 }] },
  { id: 'coal', size: 6, marks: [{ kind: 'rect', x: 0, y: 0, w: 6, h: 6, role: 'text', fill: true }] },
  {
    id: 'evaporite',
    size: 12,
    marks: [
      { kind: 'path', d: 'M2 9L6 3L10 9', role: 'text', width: 0.8 },
      { kind: 'line', x1: 6, y1: 3, x2: 6, y2: 9, role: 'text', width: 0.8 },
    ],
  },
  {
    id: 'tuff',
    size: 10,
    marks: [
      { kind: 'path', d: 'M2 7L3.5 3L5 7', role: 'text', width: 0.8 },
      { kind: 'circle', cx: 8, cy: 3, r: 0.7, role: 'text', fill: true },
    ],
  },
  {
    id: 'volcanic',
    size: 10,
    marks: [
      { kind: 'path', d: 'M1 8L3 3L5 8', role: 'text', width: 0.8 },
      { kind: 'path', d: 'M6 4L8 0L10 4', role: 'text', width: 0.8 },
    ],
  },
  {
    id: 'plutonic',
    size: 10,
    marks: [
      { kind: 'line', x1: 1, y1: 3, x2: 5, y2: 3, role: 'text', width: 0.8 },
      { kind: 'line', x1: 3, y1: 1, x2: 3, y2: 5, role: 'text', width: 0.8 },
      { kind: 'line', x1: 6, y1: 8, x2: 10, y2: 8, role: 'text', width: 0.8 },
      { kind: 'line', x1: 8, y1: 6, x2: 8, y2: 10, role: 'text', width: 0.8 },
    ],
  },
  {
    id: 'metamorphic',
    size: 12,
    marks: [{ kind: 'path', d: 'M0 6Q3 2 6 6T12 6', role: 'text', width: 0.8 }],
  },
  {
    id: 'cover',
    size: 10,
    marks: [{ kind: 'path', d: 'M1 7L3 5L5 7M6 4L8 2L10 4', role: 'text', width: 0.7 }],
  },
];

const GRAIN_WIDTH: Record<Grain, number> = {
  clay: 0.35,
  silt: 0.45,
  vf: 0.52,
  f: 0.58,
  m: 0.64,
  c: 0.7,
  vc: 0.76,
  granule: 0.82,
  pebble: 0.88,
  cobble: 0.94,
  boulder: 1,
};

export interface ColumnText {
  title: string;
  description: string;
  unit: string;
  grainLabels: Record<Grain, string>;
}

/** Draws the columns side by side, scaled to the thickest, with correlation lines between same-named units. */
const HEIGHT = 320;
const COLUMN = 90;
const GAP = 150;
const LEFT = 50;
const TOP = 20;

const label = (
  x: number,
  y: number,
  text: string,
  role: 'text' | 'muted',
  size: number,
  anchor?: 'middle' | 'end',
): Mark => ({
  kind: 'text',
  x,
  y,
  text,
  role,
  size,
  ...(anchor ? { anchor } : {}),
});

/** One unit's box, its name and note, and its base contact, with its top at y. */
function unitMarks(unit: Unit, x0: number, y: number, h: number): Mark[] {
  const w = GRAIN_WIDTH[unit.grain] * COLUMN;
  const out: Mark[] = [{ kind: 'rect', x: x0, y, w, h, role: 'text', pattern: unit.lithology, width: 1 }];
  if (h >= 10) out.push(label(x0 + COLUMN + 6, y + Math.min(h / 2 + 4, 14), unit.name, 'text', 10));
  if (unit.note && h >= 22) out.push(label(x0 + COLUMN + 6, y + Math.min(h / 2 + 16, 26), unit.note, 'muted', 9));
  const base = y + h;
  if (unit.contact === 'erosional' || unit.contact === 'unconformity') {
    const d = Array.from(
      { length: 10 },
      (_, k) => `${k ? 'L' : 'M'}${(x0 + (k * w) / 9).toFixed(1)} ${(base + (k % 2 ? 2 : -2)).toFixed(1)}`,
    ).join('');
    out.push({ kind: 'path', d, role: 'text', width: unit.contact === 'unconformity' ? 2 : 1.2 });
  } else
    out.push({
      kind: 'line',
      x1: x0,
      y1: base,
      x2: x0 + w,
      y2: base,
      role: 'text',
      dash: unit.contact === 'gradational',
    });
  return out;
}

/** The thickness scale left of the first column and the grain-size ticks under every column. */
function scaleMarks(tallest: number, count: number, words: ColumnText): Mark[] {
  const out: Mark[] = [{ kind: 'line', x1: LEFT - 8, y1: TOP, x2: LEFT - 8, y2: TOP + HEIGHT, role: 'axis' }];
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const y = TOP + k * HEIGHT;
    out.push({ kind: 'line', x1: LEFT - 12, y1: y, x2: LEFT - 8, y2: y, role: 'axis' });
    out.push(label(LEFT - 14, y + 4, String(Number((tallest * (1 - k)).toPrecision(3))), 'muted', 9, 'end'));
  }
  out.push({ ...label(10, TOP + HEIGHT / 2, words.unit, 'text', 10, 'middle'), rotate: -90 } as Mark);
  for (let ci = 0; ci < count; ci++) {
    for (const g of ['clay', 'm', 'pebble'] as const) {
      const gx = LEFT + ci * (COLUMN + GAP) + GRAIN_WIDTH[g] * COLUMN;
      out.push({ kind: 'line', x1: gx, y1: TOP + HEIGHT + 2, x2: gx, y2: TOP + HEIGHT + 6, role: 'axis' });
      out.push({ ...label(gx + 3, TOP + HEIGHT + 12, words.grainLabels[g], 'muted', 8, 'end'), rotate: -40 } as Mark);
    }
  }
  return out;
}

/** Draws the columns side by side, scaled to the thickest, with correlation lines between same-named units. */
export function drawColumns(columns: readonly Unit[][], words: ColumnText): Figure {
  const totals = columns.map((c) => c.reduce((s, u) => s + u.thickness, 0));
  const tallest = Math.max(...totals);
  const scale = HEIGHT / tallest;
  const marks: Mark[] = scaleMarks(tallest, columns.length, words);
  const tops = new Map<string, { column: number; x: number; y: number; name: string }[]>();
  columns.forEach((column, ci) => {
    const x0 = LEFT + ci * (COLUMN + GAP);
    let y = TOP + (tallest - totals[ci]) * scale;
    for (const unit of column) {
      const h = unit.thickness * scale;
      marks.push(...unitMarks(unit, x0, y, h));
      tops.set(unit.name, [...(tops.get(unit.name) ?? []), { column: ci, x: x0, y, name: unit.name }]);
      y += h;
    }
  });
  for (const list of tops.values()) {
    for (let k = 1; k < list.length; k++) {
      const [a, b] = [list[k - 1], list[k]];
      // Starts past the unit's name, which sits to the right of its column.
      const start = Math.min(a.x + COLUMN + 12 + 5.6 * a.name.length, b.x - 12);
      if (b.column === a.column + 1)
        marks.push({ kind: 'line', x1: start, y1: a.y, x2: b.x, y2: b.y, role: 's0', dash: true });
    }
  }
  return {
    width: LEFT + columns.length * (COLUMN + GAP) - GAP + 100,
    height: TOP + HEIGHT + 44,
    title: words.title,
    description: words.description,
    marks,
    patterns: PATTERNS,
  };
}
