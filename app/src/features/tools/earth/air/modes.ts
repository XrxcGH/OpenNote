// The air quality and weather observation calculations as forms: the AQI, a Gaussian plume, ppm conversions, a
// box model, METAR and TAF reports in words with a station-model picture, and radar rain rates.
import '../text';
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import type { Figure, Mark } from '../core/figure';
import { linePlot } from '../core/plot';
import { check } from '../core/problem';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import { looseT } from '../ui/form';
import { decodeMetar, decodeTaf, skyEighths } from './metar';
import type { Cloud, Conditions, Metar, Weather, Wind } from './metar';
import {
  MOLAR_MASS,
  POLLUTANTS,
  SOURCES,
  STABILITY,
  ZR,
  aqi,
  box,
  buoyancyFlux,
  groundMaximum,
  molarVolume,
  plume,
  plumeRise,
  ppmToUg,
  rainRate,
  sigmas,
  stabilityClass,
  ugToPpm,
} from './quality';
import type { Aqi, Pollutant, Sky, Stability } from './quality';

const { num, pick, text, r } = fieldsFor('air');
const word = (key: string, vars?: Readonly<Record<string, string | number>>) => looseT(`kitEarth.air.${key}`, vars);

/** Whole numbers of ten thousand or more with a space between thousands, as the kit writes them. */
const group = (value: number): string =>
  Math.abs(value) >= 10000 ? Math.round(value).toLocaleString('en-US').replace(/,/g, ' ') : fmt(value);

const aqiMode: Mode = {
  id: 'aqi',
  label: 'kitEarth.air.modes.aqi',
  intro: 'kitEarth.air.intro.aqi',
  fields: POLLUTANTS.map((p) =>
    num(p, p === 'pm25' ? '20.0' : p === 'o3_8' ? '0.065' : '', undefined, undefined, { optional: true }),
  ),
  solve(read) {
    const found: { pollutant: Pollutant; raw: number; result: Aqi }[] = [];
    for (const pollutant of POLLUTANTS) {
      const raw = read.opt(pollutant);
      if (raw !== null) found.push({ pollutant, raw, result: aqi(pollutant, raw) });
    }
    check(found.length > 0, 'aqiNone');
    const top = found.reduce((a, b) => (b.result.index > a.result.index ? b : a));
    const vars = {
      index: top.result.index,
      category: word(`category.${top.result.category}`),
      pollutant: word(`pollutant.${top.pollutant}`),
    };
    return {
      answer: t('kitEarth.air.a.aqi', vars),
      latex: `I = \\frac{I_{hi} - I_{lo}}{C_{hi} - C_{lo}}(C - C_{lo}) + I_{lo} = ${top.result.index}`,
      table: {
        header: [r('pollutant'), r('truncated'), r('aqi'), r('category')],
        rows: found.map((f) => [
          word(`pollutant.${f.pollutant}`),
          `${fmt(f.result.truncated)} ${word(`unit.${f.pollutant}`)}`,
          String(f.result.index),
          word(`category.${f.result.category}`),
        ]),
      },
      steps: [
        ...found.map((f) => {
          const [cLo, cHi, iLo, iHi] = f.result.row;
          return t('kitEarth.air.s.aqi', {
            pollutant: word(`pollutant.${f.pollutant}`),
            c: fmt(f.result.truncated),
            cLo: fmt(cLo),
            cHi: fmt(cHi),
            iLo,
            iHi,
            index: f.result.index,
          });
        }),
        t('kitEarth.air.s.overall', vars),
      ],
      figures: [aqiScale(found.map((f) => ({ label: word(`short.${f.pollutant}`), index: f.result.index })))],
      source: SOURCES.aqi,
    };
  },
};

/** The AQI scale as six labeled bands with a marker for each pollutant. */
function aqiScale(marks: readonly { label: string; index: number }[]): Figure {
  const w = 360;
  const x = (index: number) => 10 + (Math.min(index, 500) / 500) * (w - 20);
  const bands: [number, number, string][] = [
    [0, 50, 'good'],
    [51, 100, 'moderate'],
    [101, 150, 'sensitive'],
    [151, 200, 'unhealthy'],
    [201, 300, 'veryUnhealthy'],
    [301, 500, 'hazardous'],
  ];
  const out: Mark[] = [];
  bands.forEach(([lo, hi], i) => {
    out.push({
      kind: 'rect',
      x: x(lo),
      y: 40,
      w: x(hi) - x(lo),
      h: 18,
      role: (['s0', 's4', 's1', 's2', 's3', 'text'] as const)[i],
      fill: true,
      opacity: 0.25 + i * 0.1,
    });
    out.push({ kind: 'text', x: x(lo) + 2, y: 72, text: String(lo), role: 'muted', size: 9 });
  });
  out.push({ kind: 'text', x: x(500), y: 72, text: '500', role: 'muted', size: 9, anchor: 'end' });
  marks.forEach((m, i) => {
    out.push({ kind: 'line', x1: x(m.index), y1: 34, x2: x(m.index), y2: 62, role: 'text', width: 2 });
    out.push({
      kind: 'text',
      x: x(m.index),
      y: 28 - (i % 2) * 12,
      text: `${m.label} ${m.index}`,
      role: 'text',
      size: 10,
      anchor: 'middle',
    });
  });
  return {
    width: w,
    height: 84,
    title: t('kitEarth.air.plot.aqiTitle'),
    description: t('kitEarth.air.plot.aqiText', { list: marks.map((m) => `${m.label} ${m.index}`).join(', ') }),
    marks: out,
  };
}

const plumeMode: Mode = {
  id: 'plume',
  label: 'kitEarth.air.modes.plume',
  intro: 'kitEarth.air.intro.plume',
  fields: [
    num('q', '100', 'emission', 'g/s'),
    num('u', '5', 'speed'),
    num('stack', '50', 'length', 'm'),
    pick('sigmaFrom', ['briggs', 'given']),
    pick('stabilityFrom', ['sky', 'class'], { show: when('sigmaFrom', 'briggs') }),
    pick('sky', ['strong', 'moderate', 'slight', 'overcast', 'nightCloudy', 'nightClear'], {
      show: (text) => text('sigmaFrom') !== 'given' && text('stabilityFrom') !== 'class',
    }),
    pick('class', [...STABILITY], {
      show: (text) => text('sigmaFrom') !== 'given' && text('stabilityFrom') === 'class',
    }),
    pick('terrain', ['rural', 'urban'], { show: when('sigmaFrom', 'briggs') }),
    num('x', '1000', 'length', 'm', { show: when('sigmaFrom', 'briggs') }),
    num('sy', '50', 'length', 'm', { show: when('sigmaFrom', 'given') }),
    num('sz', '30', 'length', 'm', { show: when('sigmaFrom', 'given') }),
    num('y', '0', 'length', 'm'),
    num('z', '0', 'length', 'm'),
    pick('rise', ['none', 'buoyant']),
    num('exit', '15', 'speed', undefined, { show: when('rise', 'buoyant') }),
    num('diameter', '2', 'length', 'm', { show: when('rise', 'buoyant') }),
    num('stackT', '150', 'temperature', '°C', { show: when('rise', 'buoyant') }),
    num('airT', '15', 'temperature', '°C', { show: when('rise', 'buoyant') }),
  ],
  solve(read) {
    const q = read.num('q');
    const u = read.num('u');
    const given = read.pick('sigmaFrom') === 'given';
    const urban = read.pick('terrain') === 'urban';
    const x = given ? 0 : read.num('x');
    const stability: Stability | null = given
      ? null
      : read.pick('stabilityFrom') === 'class'
        ? (read.pick('class') as Stability)
        : stabilityClass(u, read.pick('sky') as Sky);
    const s = stability ? sigmas(stability, x, urban) : { sy: read.num('sy'), sz: read.num('sz') };
    const buoyant = read.pick('rise') === 'buoyant';
    const flux = buoyant
      ? buoyancyFlux(read.num('exit'), read.num('diameter'), read.num('stackT'), read.num('airT'))
      : 0;
    const rise = buoyant && !given ? plumeRise(flux, u, x) : null;
    const h = read.num('stack') + (rise?.rise ?? 0);
    const c = plume(q, u, s.sy, s.sz, h, read.num('y'), read.num('z'));
    const ug = c * 1e9;
    const vars = { value: fmt(ug, 6), h: fmt(h, 4) };
    const rows: [string, string][] = [
      [r('concentration'), `${fmt(ug, 6)} µg/m³`],
      [r('sy'), `${fmt(s.sy, 6)} m`],
      [r('sz'), `${fmt(s.sz, 6)} m`],
      [r('h'), `${fmt(h, 4)} m`],
    ];
    if (stability) rows.push([r('stability'), stability]);
    if (rise) rows.push([r('rise'), `${fmt(rise.rise, 4)} m`], [r('flux'), `${fmt(flux, 4)} m⁴/s³`]);
    const steps = [
      ...(stability
        ? [t('kitEarth.air.s.stability', { stability, terrain: word(`o.${urban ? 'urban' : 'rural'}`) })]
        : []),
      ...(stability ? [t('kitEarth.air.s.sigmas', { x: fmt(x), sy: fmt(s.sy, 6), sz: fmt(s.sz, 6) })] : []),
      ...(rise
        ? [t('kitEarth.air.s.rise', { flux: fmt(flux, 4), rise: fmt(rise.rise, 4), final: fmt(rise.finalDistance, 4) })]
        : []),
      t('kitEarth.air.s.plumeValues', { q: fmt(q * 1000), u: fmt(u), sy: fmt(s.sy, 6), sz: fmt(s.sz, 6), h: vars.h }),
      t('kitEarth.air.s.plume', vars),
    ];
    const figures: Figure[] = [];
    if (stability) {
      const hFor = (d: number) => read.num('stack') + (buoyant ? plumeRise(flux, u, d).rise : 0);
      const max = buoyant ? null : groundMaximum(q, u, h, stability, urban);
      if (max) {
        rows.push([r('max'), `${fmt(max.c * 1e9, 4)} µg/m³`], [r('maxAt'), `${fmt(max.x, 4)} m`]);
        steps.push(t('kitEarth.air.s.max', { c: fmt(max.c * 1e9, 4), x: fmt(max.x, 4) }));
      }
      const points = Array.from({ length: 81 }, (_, k) => {
        const d = 50 * 400 ** (k / 80);
        const sd = sigmas(stability, d, urban);
        return [d, plume(q, u, sd.sy, sd.sz, hFor(d)) * 1e9] as const;
      });
      figures.push(
        linePlot({
          title: t('kitEarth.air.plot.plumeTitle'),
          description: t('kitEarth.air.plot.plumeText', { stability, h: fmt(h, 4) }),
          xLabel: t('kitEarth.air.plot.downwind'),
          yLabel: t('kitEarth.air.plot.ground'),
          logX: true,
          series: [{ points, role: 's0' }],
          vlines: [{ x }],
        }),
      );
    }
    return {
      answer: t('kitEarth.air.a.plume', vars),
      latex:
        `C = \\frac{Q}{2\\pi u \\sigma_y \\sigma_z} e^{-y^2/2\\sigma_y^2}` +
        `\\left[e^{-(z-H)^2/2\\sigma_z^2} + e^{-(z+H)^2/2\\sigma_z^2}\\right] = ${tex(ug)}\\ \\mathrm{\\mu g/m^3}`,
      rows,
      steps,
      figures,
      source: SOURCES.plume,
    };
  },
};

const GASES = [...(Object.keys(MOLAR_MASS) as (keyof typeof MOLAR_MASS)[]), 'custom'] as const;

const convert: Mode = {
  id: 'convert',
  label: 'kitEarth.air.modes.convert',
  fields: [
    pick('gas', GASES),
    num('molar', '64.066', undefined, undefined, { show: when('gas', 'custom') }),
    pick('direction', ['toUg', 'toPpm']),
    num('mixing', '1', undefined, undefined, { show: when('direction', 'toUg') }),
    pick('scale', ['ppm', 'ppb'], { show: when('direction', 'toUg') }),
    num('mass', '2620.29', 'concentration', 'µg/m³', { show: when('direction', 'toPpm') }),
    num('temperature', '25', 'temperature', '°C'),
    num('pressure', '1', 'pressure', 'atm'),
  ],
  solve(read) {
    const gas = read.pick('gas');
    const molar = gas === 'custom' ? read.num('molar') : MOLAR_MASS[gas as keyof typeof MOLAR_MASS];
    check(molar > 0, 'molar');
    const vm = molarVolume(read.num('temperature'), read.num('pressure'));
    const vars = { vm: fmt(vm, 6), molar: fmt(molar, 6) };
    if (read.pick('direction') === 'toUg') {
      const ppm = read.num('mixing') / (read.pick('scale') === 'ppb' ? 1000 : 1);
      const ug = ppmToUg(ppm, molar, vm);
      return {
        answer: t('kitEarth.air.a.toUg', { ppm: fmt(ppm), value: fmt(ug, 6) }),
        latex: `C = \\frac{\\text{ppm} \\times M \\times 1000}{V_m} = ${tex(ug)}\\ \\mathrm{\\mu g/m^3}`,
        rows: [
          [r('ug'), `${fmt(ug, 6)} µg/m³`],
          [r('vm'), `${fmt(vm, 6)} L/mol`],
          [r('molar'), `${fmt(molar, 6)} g/mol`],
        ],
        steps: [t('kitEarth.air.s.vm', vars), t('kitEarth.air.s.toUg', { ppm: fmt(ppm), ...vars, value: fmt(ug, 6) })],
      };
    }
    const ug = read.num('mass') * 1e9;
    const ppm = ugToPpm(ug, molar, vm);
    return {
      answer: t('kitEarth.air.a.toPpm', { ug: fmt(ug), value: fmt(ppm, 6), ppb: fmt(ppm * 1000, 6) }),
      latex: `\\text{ppm} = \\frac{C V_m}{M \\times 1000} = ${tex(ppm)}`,
      rows: [
        [r('ppm'), fmt(ppm, 6)],
        [r('ppb'), fmt(ppm * 1000, 6)],
        [r('vm'), `${fmt(vm, 6)} L/mol`],
      ],
      steps: [t('kitEarth.air.s.vm', vars), t('kitEarth.air.s.toPpm', { ug: fmt(ug), ...vars, value: fmt(ppm, 6) })],
    };
  },
};

const boxMode: Mode = {
  id: 'box',
  label: 'kitEarth.air.modes.box',
  intro: 'kitEarth.air.intro.box',
  fields: [
    num('emission', '1', 'emission', 'kg/s'),
    num('length', '20', 'distance', 'km'),
    num('width', '20', 'distance', 'km'),
    num('height', '1000', 'length', 'm'),
    num('u', '3', 'speed'),
    num('inflow', '10', 'concentration', 'µg/m³'),
    num('loss', '0.1', 'loss', '1/h'),
    num('start', '10', 'concentration', 'µg/m³'),
  ],
  solve(read) {
    const b = box(
      read.num('emission'),
      read.num('length'),
      read.num('width'),
      read.num('height'),
      read.num('u'),
      read.num('inflow'),
      read.num('loss'),
      read.num('start'),
    );
    const hours = Math.max((5 * b.tau) / 3600, 1);
    const points = Array.from({ length: 61 }, (_, k) => {
      const at = (k / 60) * hours;
      return [at, b.at(at * 3600) * 1e9] as const;
    });
    const vars = { steady: fmt(b.steady * 1e9, 5), tau: fmt(b.tau / 3600, 4) };
    return {
      answer: t('kitEarth.air.a.box', vars),
      latex: `C_{ss} = \\frac{E/(LWH) + (u/L) C_{in}}{u/L + k} = ${tex(b.steady * 1e9, 5)}\\ \\mathrm{\\mu g/m^3}`,
      rows: [
        [r('steady'), `${vars.steady} µg/m³`],
        [r('tau'), `${vars.tau} h`],
        [r('after'), `${fmt(b.at(3600) * 1e9, 5)} µg/m³`],
      ],
      steps: [t('kitEarth.air.s.balance'), t('kitEarth.air.s.steady', vars), t('kitEarth.air.s.tau', vars)],
      figures: [
        linePlot({
          title: t('kitEarth.air.plot.boxTitle'),
          description: t('kitEarth.air.plot.boxText', vars),
          xLabel: t('kitEarth.air.plot.hours'),
          yLabel: t('kitEarth.air.plot.concentration'),
          series: [{ points, role: 's0' }],
          hlines: [{ y: b.steady * 1e9 }],
        }),
      ],
    };
  },
};

function windText(w: Wind | undefined): string | null {
  if (!w) return null;
  if (w.speed === 0 && w.direction === 0) return word('w.calm');
  const unit = word(`w.${w.unit}`);
  const base =
    w.direction === null
      ? word('w.variable', { speed: `${w.speed} ${unit}` })
      : word('w.from', { direction: String(w.direction).padStart(3, '0'), speed: `${w.speed} ${unit}` });
  const gust = w.gust !== null ? word('w.gust', { gust: `${w.gust} ${unit}` }) : '';
  const varying = w.from !== undefined ? word('w.varying', { from: w.from, to: w.to ?? 0 }) : '';
  return `${base}${gust}${varying}`;
}

function weatherText(w: Weather): string {
  if (w.code === 'NSW') return word('wx.nsw');
  const what = w.phenomena.map((p) => word(`wx.${p}`)).join(word('wx.and'));
  let out = w.descriptor ? word(`wx.d${w.descriptor}${what ? '' : 'Alone'}`, { what }) : what;
  if (w.intensity === 'light' || w.intensity === 'heavy') out = word(`wx.${w.intensity}`, { what: out });
  if (w.intensity === 'vicinity') out = word('wx.vicinity', { what: out });
  return out;
}

function cloudText(clouds: readonly Cloud[]): string | null {
  if (clouds.length === 0) return null;
  return clouds
    .map((c) => {
      const type = c.type ? word(`sky.${c.type}`) : '';
      return c.base === null
        ? word(`sky.${c.cover}`)
        : word('sky.layer', { cover: word(`sky.${c.cover}`), base: group(c.base), type });
    })
    .join(word('wx.and'));
}

function conditionRows(c: Conditions): [string, string][] {
  const rows: [string, string][] = [];
  const w = windText(c.wind);
  if (w) rows.push([r('wind'), w]);
  if (c.visibility) {
    const v = c.visibility;
    const text = v.cavok
      ? word('vis.cavok')
      : v.meters
        ? v.value >= 9999
          ? word('vis.tenKm')
          : word('vis.meters', { value: group(v.value) })
        : word(v.bound ? `vis.${v.bound}` : 'vis.miles', { value: fmt(v.value, 3) });
    rows.push([r('visibility'), text]);
  }
  for (const x of c.weather) rows.push([r('weather'), weatherText(x)]);
  const sky = cloudText(c.clouds);
  if (sky) rows.push([r('clouds'), sky]);
  return rows;
}

/** Relative humidity from temperature and dew point by Bolton's (1980) saturation vapor pressure. */
const humidity = (tc: number, td: number): number => {
  const es = (x: number) => 6.112 * Math.exp((17.67 * x) / (x + 243.5));
  return (100 * es(td)) / es(tc);
};

function metarRows(m: Metar): [string, string][] {
  const rows: [string, string][] = [];
  if (m.station)
    rows.push([
      r('station'),
      m.time
        ? word('station.at', {
            station: m.station,
            day: m.day ?? 0,
            time: `${m.time.slice(0, 2)}:${m.time.slice(2)}`,
          })
        : m.station,
    ]);
  if (m.auto) rows.push([r('report'), word('station.auto')]);
  rows.push(...conditionRows(m));
  if (m.temperature !== undefined) {
    rows.push([
      r('temperature'),
      m.dewPoint !== undefined
        ? word('temp.both', {
            t: fmt(m.temperature),
            td: fmt(m.dewPoint),
            rh: fmt(humidity(m.temperature, m.dewPoint), 3),
          })
        : word('temp.only', { t: fmt(m.temperature) }),
    ]);
  }
  if (m.altimeter)
    rows.push([
      r('altimeter'),
      `${m.altimeter.unit === 'inHg' ? m.altimeter.value.toFixed(2) : m.altimeter.value} ${m.altimeter.unit}`,
    ]);
  for (const runway of m.runway) rows.push([r('runway'), runway]);
  const rm = m.remarks;
  if (rm.station) rows.push([r('remarks'), word(`rmk.${rm.station}`)]);
  if (rm.seaLevel !== undefined) rows.push([r('slp'), `${rm.seaLevel.toFixed(1)} hPa`]);
  if (rm.precise)
    rows.push([
      r('precise'),
      rm.precise.dewPoint === null
        ? word('temp.only', { t: rm.precise.temperature.toFixed(1) })
        : word('temp.precise', { t: rm.precise.temperature.toFixed(1), td: rm.precise.dewPoint.toFixed(1) }),
    ]);
  if (rm.hourlyPrecip !== undefined)
    rows.push([r('precip'), word('rmk.precip', { value: rm.hourlyPrecip.toFixed(2) })]);
  if (rm.rising) rows.push([r('remarks'), word('rmk.rising')]);
  if (rm.falling) rows.push([r('remarks'), word('rmk.falling')]);
  if (rm.other.length) rows.push([r('other'), rm.other.join(' ')]);
  if (m.unknown.length) rows.push([r('unknown'), m.unknown.join(' ')]);
  return rows;
}

const knots = (w: Wind): number =>
  w.unit === 'KT' ? w.speed : w.unit === 'MPS' ? w.speed * 1.943844 : w.speed / 1.852;

/** A station model: sky cover in the circle, a wind barb, and the temperature, dew point, and pressure around it. */
export function stationModel(m: Metar): Figure {
  const cx = 110;
  const cy = 100;
  const radius = 10;
  const marks: Mark[] = [{ kind: 'circle', cx, cy, r: radius, role: 'text' }];
  const eighths = skyEighths(m.clouds);
  if (eighths === 8) marks.push({ kind: 'circle', cx, cy, r: radius, role: 'text', fill: true });
  else if (eighths && eighths > 0) {
    const turn = (eighths / 8) * 2 * Math.PI;
    const ex = cx + radius * Math.sin(turn);
    const ey = cy - radius * Math.cos(turn);
    marks.push({
      kind: 'path',
      d: `M${cx} ${cy}L${cx} ${cy - radius}A${radius} ${radius} 0 ${turn > Math.PI ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}Z`,
      role: 'text',
      fill: true,
    });
  } else if (eighths === null)
    marks.push({ kind: 'text', x: cx, y: cy + 4, text: 'M', role: 'text', anchor: 'middle' });
  const w = m.wind;
  if (w && w.direction !== null && w.speed > 0) {
    const a = (w.direction * Math.PI) / 180;
    const dir = [Math.sin(a), -Math.cos(a)];
    const side = [-dir[1], dir[0]];
    const at = (d: number) => [cx + dir[0] * d, cy + dir[1] * d];
    const [x1, y1] = at(radius);
    const [x2, y2] = at(radius + 50);
    marks.push({ kind: 'line', x1, y1, x2, y2, role: 'text' });
    let left = Math.round(knots(w) / 5) * 5;
    let d = radius + 50;
    while (left >= 50) {
      const [px, py] = at(d);
      const [qx, qy] = at(d - 8);
      const tip = `${(px + side[0] * 16).toFixed(2)} ${(py + side[1] * 16).toFixed(2)}`;
      const d0 = `M${px.toFixed(2)} ${py.toFixed(2)}L${tip}L${qx.toFixed(2)} ${qy.toFixed(2)}Z`;
      marks.push({ kind: 'path', d: d0, role: 'text', fill: true });
      left -= 50;
      d -= 10;
    }
    while (left >= 5) {
      const long = left >= 10 ? 16 : 8;
      const [px, py] = at(d);
      marks.push({
        kind: 'line',
        x1: px,
        y1: py,
        x2: px + side[0] * long + dir[0] * long * 0.3,
        y2: py + side[1] * long + dir[1] * long * 0.3,
        role: 'text',
      });
      left -= left >= 10 ? 10 : 5;
      d -= 6;
    }
  } else if (w && w.speed === 0) marks.push({ kind: 'circle', cx, cy, r: radius + 4, role: 'text' });
  const label = (x: number, y: number, value: string, anchor: 'start' | 'end') =>
    marks.push({ kind: 'text', x, y, text: value, role: 'text', anchor, size: 12 });
  if (m.temperature !== undefined) label(cx - 16, cy - 10, fmt(m.temperature), 'end');
  if (m.dewPoint !== undefined) label(cx - 16, cy + 22, fmt(m.dewPoint), 'end');
  if (m.remarks.seaLevel !== undefined)
    label(cx + 16, cy - 10, String(Math.round(m.remarks.seaLevel * 10) % 1000).padStart(3, '0'), 'start');
  if (m.weather.length) label(cx - 16, cy + 6, m.weather.map((x) => x.code).join(' '), 'end');
  if (m.visibility && !m.visibility.meters) label(cx - 52, cy + 6, fmt(m.visibility.value, 3), 'end');
  return {
    width: 220,
    height: 200,
    title: t('kitEarth.air.plot.stationTitle', { station: m.station || '—' }),
    description: t('kitEarth.air.plot.stationText', {
      sky: eighths === null ? word('sky.missing') : word('sky.eighths', { count: eighths }),
      wind: windText(m.wind) ?? word('w.none'),
    }),
    marks,
  };
}

const report: Mode = {
  id: 'report',
  label: 'kitEarth.air.modes.report',
  intro: 'kitEarth.air.intro.report',
  fields: [
    text('report', 'KORD 231751Z 25012G20KT 10SM FEW020 SCT250 22/14 A2992 RMK AO2 SLP132 T02220139', 'area', {
      rows: 3,
    }),
  ],
  solve(read) {
    const raw = read.raw('report');
    if (/^TAF\b/i.test(raw)) {
      const taf = decodeTaf(raw);
      const rows: [string, string][] = [];
      if (taf.station)
        rows.push([
          r('station'),
          word('taf.valid', {
            station: taf.station,
            from: taf.validFrom ?? '—',
            to: taf.validTo ?? '—',
          }),
        ]);
      for (const p of taf.periods) {
        const head =
          p.change === 'BASE'
            ? word('taf.base')
            : p.change === 'FM'
              ? word('taf.fm', { time: p.start ?? '' })
              : p.change === 'PROB'
                ? word('taf.prob', { chance: p.probability ?? 0, from: p.start ?? '', to: p.end ?? '' })
                : word(`taf.${p.change}`, { from: p.start ?? '', to: p.end ?? '' });
        const parts = conditionRows(p).map(([name, value]) => `${name.toLowerCase()} ${value}`);
        rows.push([head, parts.join('; ') || '—']);
      }
      if (taf.unknown.length) rows.push([r('unknown'), taf.unknown.join(' ')]);
      return {
        answer: t('kitEarth.air.a.taf', { station: taf.station || '—', count: taf.periods.length }),
        table: { header: [r('period'), r('forecast')], rows: rows.map(([a, b]) => [a, b]) },
        steps: [t('kitEarth.air.s.taf')],
      };
    }
    const m = decodeMetar(raw);
    const rows = metarRows(m);
    return {
      answer: rows
        .filter(([name]) => name !== r('station'))
        .slice(0, 6)
        .map(([name, value]) => `${name}: ${value}`)
        .join('; '),
      table: { header: [r('group'), r('meaning')], rows: rows.map(([a, b]) => [a, b]) },
      steps: [t('kitEarth.air.s.metar')],
      figures: [stationModel(m)],
    };
  },
};

const radar: Mode = {
  id: 'radar',
  label: 'kitEarth.air.modes.radar',
  fields: [
    num('dbz', '40'),
    pick('relation', [...(Object.keys(ZR) as (keyof typeof ZR)[]), 'custom']),
    num('a', '200', undefined, undefined, { show: when('relation', 'custom') }),
    num('b', '1.6', undefined, undefined, { show: when('relation', 'custom') }),
  ],
  solve(read) {
    const relation = read.pick('relation');
    const { a, b } = relation === 'custom' ? { a: read.num('a'), b: read.num('b') } : ZR[relation as keyof typeof ZR];
    const out = rainRate(read.num('dbz'), a, b);
    const vars = { rate: fmt(out.rate, 6), z: fmt(out.z), a: fmt(a), b: fmt(b), dbz: fmt(read.num('dbz')) };
    const curve = Array.from({ length: 51 }, (_, k) => {
      const dbz = 10 + k;
      return [dbz, rainRate(dbz, a, b).rate] as const;
    });
    return {
      answer: t('kitEarth.air.a.radar', vars),
      latex: `R = (Z/a)^{1/b} = (${tex(out.z)}/${tex(a)})^{1/${tex(b)}} = ${tex(out.rate)}\\ \\mathrm{mm/h}`,
      rows: [
        [r('z'), `${fmt(out.z)} mm⁶/m³`],
        [r('rate'), `${fmt(out.rate, 6)} mm/h`],
        [r('inches'), `${fmt(out.rate / 25.4, 4)} in/h`],
      ],
      steps: [t('kitEarth.air.s.z', vars), t('kitEarth.air.s.rate', vars)],
      figures: [
        linePlot({
          title: t('kitEarth.air.plot.radarTitle'),
          description: t('kitEarth.air.plot.radarText', vars),
          xLabel: t('kitEarth.air.plot.dbz'),
          yLabel: t('kitEarth.air.plot.rate'),
          logY: true,
          series: [{ points: curve, role: 's0' }],
          vlines: [{ x: read.num('dbz') }],
        }),
      ],
      source: SOURCES.radar,
    };
  },
};

export const AIR_MODES: readonly Mode[] = [aqiMode, plumeMode, convert, boxMode, report, radar];
