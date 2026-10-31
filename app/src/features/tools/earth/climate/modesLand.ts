// The climate calculations that read monthly normals or activity data: Köppen-Geiger with its rule path and a
// Walter-Lieth diagram, the Holdridge life zone, the Thornthwaite water balance, degree days, and footprints.
import '../text';
import { fmt } from '../core/format';
import { linePlot } from '../core/plot';
import { numberRows, splitRows } from '../core/rows';
import { readNumber } from '../core/format';
import { Problem } from '../core/problem';
import { fieldsFor, when } from '../ui/fields';
import type { Mode, Reader } from '../ui/form';
import { looseT } from '../ui/form';
import { biotemperature, dryMonths, holdridge, koppen } from './classify';
import type { Normals } from './classify';
import { EPA_FACTORS, footprint, readActivities, toPounds } from './footprint';
import { degreeDays, waterBalance } from './water';

const { num, pick, text, r } = fieldsFor('climate');
const word = (key: string, vars?: Readonly<Record<string, string | number>>): string =>
  looseT(`kitEarth.climate.${key}`, vars);

const NORMALS = '12, 100\n13, 90\n15, 70\n17, 40\n20, 15\n24, 3\n27, 1\n27, 2\n25, 10\n21, 40\n16, 70\n13, 90';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const month = (i: number) => word(`month.${MONTHS[i]}`);
/** One tick per month, labeled with its initial, so a point on a monthly plot reads as its month. */
const monthTicks = () => MONTHS.map((m, i) => ({ x: i + 1, label: word(`monthInitial.${m}`) }));

/** Twelve lines of temperature (°C) and precipitation (mm), and the hemisphere. */
function readNormals(read: Reader, south = read.pick('hemisphere') === 'south'): Normals {
  const rows = numberRows(read.raw('normals'), 2);
  if (rows.length !== 12) throw new Problem('twelve');
  return { t: rows.map((row) => row[0]), p: rows.map((row) => row[1]), south };
}

const normalsFields = [text('normals', NORMALS, 'area', { rows: 12 }), pick('hemisphere', ['north', 'south'])];

function walterLieth(n: Normals, code: string) {
  const dry = dryMonths(n);
  return linePlot({
    title: word('plot.walterTitle'),
    description: word('plot.walterText', {
      code,
      dry: dry.length ? dry.map(month).join(', ') : word('none'),
    }),
    xLabel: word('plot.month'),
    yLabel: word('plot.walterAxis'),
    series: [
      { points: n.t.map((v, i) => [i + 1, v] as const), label: word('plot.temperatureC') },
      { points: n.p.map((v, i) => [i + 1, v / 2] as const), label: word('plot.halfRain'), role: 's1' },
    ],
    x: [1, 12],
    xTicks: monthTicks(),
  });
}

/** Rules that state a value rather than ask a question, so they take no yes or no. */
const STATEMENTS = new Set(['threshold', 'noDrySeason']);

const koppenMode: Mode = {
  id: 'koppen',
  label: 'kitEarth.climate.modes.koppen',
  intro: 'kitEarth.climate.intro.normals',
  fields: normalsFields,
  solve(read) {
    const n = readNormals(read);
    const k = koppen(n);
    const letters = [...k.code];
    const meaning = letters.map((letter, i) => word(`k${i}.${letter}`)).join(', ');
    const vars = { code: k.code, meaning, mat: fmt(k.mat, 4), map: fmt(k.map, 5) };
    return {
      answer: word('a.koppen', vars),
      rows: [
        [r('code'), k.code],
        [r('meaning'), meaning],
        [r('mat'), `${vars.mat} °C`],
        [r('map'), `${vars.map} mm`],
        [r('hot'), `${fmt(k.hot)} °C`],
        [r('cold'), `${fmt(k.cold)} °C`],
        [r('pth'), `${fmt(k.threshold, 4)} mm`],
      ],
      table: {
        header: [r('month'), r('t'), r('p')],
        rows: n.t.map((v, i) => [month(i), fmt(v), fmt(n.p[i])]),
      },
      steps: k.tests.map((test) =>
        STATEMENTS.has(test.rule)
          ? word(`rule.${test.rule}`, test.vars)
          : `${word(`rule.${test.rule}`, test.vars)} ${word(test.held ? 'yes' : 'no')}`,
      ),
      figures: [walterLieth(n, k.code)],
      source: word('sources.peel'),
    };
  },
};

const holdridgeMode: Mode = {
  id: 'holdridge',
  label: 'kitEarth.climate.modes.holdridge',
  intro: 'kitEarth.climate.intro.holdridge',
  fields: [
    pick('given', ['direct', 'monthly']),
    num('bio', '8.5', undefined, undefined, { show: when('given', 'direct') }),
    num('precip', '700', 'precipitation', 'mm', { show: when('given', 'direct') }),
    { ...normalsFields[0], show: when('given', 'monthly') },
  ],
  solve(read) {
    const monthly = read.pick('given') === 'monthly';
    const n = monthly ? readNormals(read, false) : null;
    const bio = n ? biotemperature(n.t) : read.num('bio');
    const precip = n ? n.p.reduce((s, v) => s + v, 0) : read.num('precip') * 1000;
    const h = holdridge(bio, precip);
    const vars = {
      bio: fmt(bio, 4),
      p: fmt(precip, 5),
      ratio: fmt(h.ratio, 4),
      belt: word(`belt.${h.belt}`),
      province: word(`province.${h.province}`),
      zone: word(`zone.${h.zone}`),
    };
    return {
      answer: word('a.holdridge', vars),
      latex: `\\mathrm{PET\\ ratio} = \\frac{58.93\\,\\mathrm{BT}}{P} = ${fmt(h.ratio, 4)}`,
      rows: [
        [r('bio'), `${vars.bio} °C`],
        [r('annualP'), `${vars.p} mm`],
        [r('ratio'), vars.ratio],
        [r('belt'), vars.belt],
        [r('province'), vars.province],
        [r('zone'), vars.zone],
      ],
      steps: [word(monthly ? 's.bioMonthly' : 's.bioGiven', vars), word('s.ratio', vars), word('s.hexagon', vars)],
      source: word('sources.holdridge'),
    };
  },
};

const water: Mode = {
  id: 'water',
  label: 'kitEarth.climate.modes.water',
  intro: 'kitEarth.climate.intro.normals',
  fields: [normalsFields[0], num('lat', '38'), num('capacity', '100', 'precipitation', 'mm')],
  solve(read) {
    const n = readNormals(read, false);
    const lat = read.num('lat');
    const out = waterBalance(n.t, n.p, lat, read.num('capacity') * 1000);
    const vars = {
      heat: fmt(out.heat, 6),
      a: fmt(out.a, 6),
      pet: fmt(out.totals.pet, 5),
      aet: fmt(out.totals.aet, 5),
      deficit: fmt(out.totals.deficit, 5),
      surplus: fmt(out.totals.surplus, 5),
      lat: fmt(lat),
    };
    const series = (key: 'p' | 'pet' | 'aet') => out.months.map((m, i) => [i + 1, m[key]] as const);
    return {
      answer: word('a.water', vars),
      latex: `I = \\sum (T/5)^{1.514} = ${vars.heat},\\quad \\mathrm{PET} = 16\\left(\\frac{10T}{I}\\right)^{a},\\ a = ${vars.a}`,
      rows: [
        [r('heat'), vars.heat],
        [r('a'), vars.a],
        [r('pet'), `${vars.pet} mm`],
        [r('aet'), `${vars.aet} mm`],
        [r('deficit'), `${vars.deficit} mm`],
        [r('surplus'), `${vars.surplus} mm`],
      ],
      table: {
        header: [r('month'), r('t'), r('p'), r('raw'), r('pet'), r('aet'), r('storage'), r('deficit'), r('surplus')],
        rows: out.months.map((m, i) => [
          month(i),
          fmt(m.t),
          fmt(m.p),
          fmt(m.raw, 4),
          fmt(m.pet, 4),
          fmt(m.aet, 4),
          fmt(m.storage, 4),
          fmt(m.deficit, 4),
          fmt(m.surplus, 4),
        ]),
      },
      steps: [word('s.heat', vars), word('s.pet'), word('s.adjust', vars), word('s.bucket'), word('s.totals', vars)],
      figures: [
        linePlot({
          title: word('plot.waterTitle'),
          description: word('plot.waterText', vars),
          xLabel: word('plot.month'),
          yLabel: word('plot.mm'),
          series: [
            { points: series('p'), label: word('plot.p') },
            { points: series('pet'), label: word('plot.pet'), dash: true },
            { points: series('aet'), label: word('plot.aet') },
          ],
          x: [1, 12],
          xTicks: monthTicks(),
        }),
      ],
      source: word('sources.thornthwaite'),
    };
  },
};

const degree: Mode = {
  id: 'degree',
  label: 'kitEarth.climate.modes.degree',
  intro: 'kitEarth.climate.intro.degree',
  fields: [text('means', '10, 15, 20, 25', 'area', { rows: 4 }), pick('scale', ['c', 'f']), num('base', '18')],
  solve(read) {
    const means = splitRows(read.raw('means')).flatMap((row) =>
      row.cells.map((cell) => {
        const v = readNumber(cell);
        if (v === null || Number.isNaN(v)) throw new Problem('rowNumber', { line: row.line, cell });
        return v;
      }),
    );
    const base = read.num('base');
    const out = degreeDays(means, base);
    const unit = read.pick('scale') === 'f' ? '°F' : '°C';
    const vars = { hdd: fmt(out.heating), cdd: fmt(out.cooling), base: fmt(base), unit, days: means.length };
    return {
      answer: word('a.degree', vars),
      latex: `\\mathrm{HDD} = \\sum \\max(T_b - \\bar T, 0) = ${vars.hdd},\\quad \\mathrm{CDD} = ${vars.cdd}`,
      rows: [
        [r('hdd'), `${vars.hdd} ${unit}·${word('dayUnit')}`],
        [r('cdd'), `${vars.cdd} ${unit}·${word('dayUnit')}`],
        [r('days'), String(means.length)],
      ],
      steps: [word('s.degree', vars)],
    };
  },
};

const DEFAULT_ACTIVITIES =
  '1000, 0.4, 2, electricity kWh\n120, 8.78, 1, gasoline gal\n300, 0.05444, 1, natural gas scf';

const footprintMode: Mode = {
  id: 'footprint',
  label: 'kitEarth.climate.modes.footprint',
  intro: 'kitEarth.climate.intro.footprint',
  fields: [text('activities', DEFAULT_ACTIVITIES, 'area', { rows: 6 })],
  solve(read) {
    const out = footprint(readActivities(read.raw('activities')));
    const vars = { kg: fmt(out.total, 6), t: fmt(out.total / 1000, 6), lb: fmt(toPounds(out.total), 6) };
    return {
      answer: word('a.footprint', vars),
      latex: `E = \\sum_i A_i\\,EF_i = ${fmt(out.total, 6)}\\ \\mathrm{kg\\ CO_2e}`,
      rows: [
        [r('scope1'), `${fmt(out.scopes[0], 6)} kg`],
        [r('scope2'), `${fmt(out.scopes[1], 6)} kg`],
        [r('scope3'), `${fmt(out.scopes[2], 6)} kg`],
        [r('total'), `${vars.kg} kg (${vars.t} t, ${vars.lb} lb)`],
      ],
      table: {
        header: [r('activity'), r('amount'), r('factor'), r('scope'), r('kg')],
        rows: out.lines.map((line) => [
          line.activity.label || word('unnamed'),
          fmt(line.activity.amount),
          fmt(line.activity.factor),
          String(line.activity.scope),
          fmt(line.kg, 6),
        ]),
      },
      steps: [
        ...out.lines.map((line) =>
          word('s.line', {
            label: line.activity.label || word('unnamed'),
            amount: fmt(line.activity.amount),
            factor: fmt(line.activity.factor),
            kg: fmt(line.kg, 6),
          }),
        ),
        word('s.sum', vars),
      ],
      note: word('factors', {
        list: EPA_FACTORS.map((f) => `${word(`factor.${f.id}`)} ${f.factor} kg/${f.unit}`).join('; '),
      }),
      source: word('sources.epa'),
    };
  },
};

export const LAND_MODES: readonly Mode[] = [koppenMode, holdridgeMode, water, degree, footprintMode];
