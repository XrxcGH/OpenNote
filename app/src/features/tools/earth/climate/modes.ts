// The radiation and climate-model calculations as forms: energy balance and greenhouse layers, radiative forcing,
// one- and two-box responses, the ice-albedo model's two states, the Budyko-Sellers model, and insolation.
import '../text';
import { fmt, tex } from '../core/format';
import { linePlot } from '../core/plot';
import { check } from '../core/problem';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import { looseT } from '../ui/form';
import {
  SEAWATER_HEAT,
  boxPath,
  boxTimes,
  budykoSellers,
  effectiveTemperature,
  equilibria,
  forcing,
  hysteresis,
  layerTemperatures,
  leakyLayer,
  rampForcing,
  tippingPoints,
} from './energy';
import type { Gas } from './energy';
import { annualMean, dailyInsolation, latitudesAt, solarLongitude, yearAt } from './insolation';
import { LAND_MODES } from './modesLand';

const { num, pick, r } = fieldsFor('climate');
const word = (key: string, vars?: Readonly<Record<string, string | number>>): string =>
  looseT(`kitEarth.climate.${key}`, vars);
const K = (k: number) => `${fmt(k, 6)} K (${fmt(k - 273.15, 5)} °C)`;

const balance: Mode = {
  id: 'balance',
  label: 'kitEarth.climate.modes.balance',
  fields: [
    num('s0', '1361', 'power', 'W/m²'),
    num('albedo', '0.3'),
    pick('model', ['layers', 'leaky']),
    num('layers', '1', undefined, undefined, { show: when('model', 'layers') }),
    num('emissivity', '0.78', undefined, undefined, { show: when('model', 'leaky') }),
  ],
  solve(read) {
    const s0 = read.num('s0');
    const albedo = read.num('albedo');
    const te = effectiveTemperature(s0, albedo);
    const vars = { s0: fmt(s0), albedo: fmt(albedo), te: fmt(te, 6) };
    if (read.pick('model') === 'layers') {
      const n = read.num('layers');
      const out = layerTemperatures(te, n);
      const all = { ...vars, n, ts: fmt(out.surface, 6) };
      return {
        answer: word('a.layers', all),
        latex: `T_s = (N + 1)^{1/4} T_e = ${n + 1}^{1/4} \\times ${tex(te)} = ${tex(out.surface)}\\ \\mathrm{K}`,
        rows: [
          [r('te'), K(te)],
          [r('ts'), K(out.surface)],
          ...out.layers.map((v, i): [string, string] => [word('r.layer', { k: i + 1 }), K(v)]),
        ],
        steps: [word('s.te', vars), word('s.layers', all)],
      };
    }
    const eps = read.num('emissivity');
    const out = leakyLayer(te, eps);
    const all = { ...vars, eps: fmt(eps), ts: fmt(out.surface, 6), ta: fmt(out.air, 6) };
    return {
      answer: word('a.leaky', all),
      latex: `T_s = T_e\\left(\\frac{2}{2 - \\varepsilon}\\right)^{1/4} = ${tex(out.surface)}\\ \\mathrm{K}`,
      rows: [
        [r('te'), K(te)],
        [r('ts'), K(out.surface)],
        [r('ta'), K(out.air)],
      ],
      steps: [word('s.te', vars), word('s.leaky', all)],
    };
  },
};

const GAS_FIELDS: Record<Gas, [string, string, string]> = {
  co2: ['co2', 'co20', ''],
  ch4: ['ch4', 'ch40', 'n2oRef'],
  n2o: ['n2o', 'n2o0', 'ch4Ref'],
};

const forcingMode: Mode = {
  id: 'forcing',
  label: 'kitEarth.climate.modes.forcing',
  fields: [
    pick('gas', ['co2', 'ch4', 'n2o']),
    num('co2', '560', undefined, undefined, { show: when('gas', 'co2') }),
    num('co20', '280', undefined, undefined, { show: when('gas', 'co2') }),
    num('ch4', '1745', undefined, undefined, { show: when('gas', 'ch4') }),
    num('ch40', '700', undefined, undefined, { show: when('gas', 'ch4') }),
    num('n2oRef', '270', undefined, undefined, { show: when('gas', 'ch4') }),
    num('n2o', '314', undefined, undefined, { show: when('gas', 'n2o') }),
    num('n2o0', '270', undefined, undefined, { show: when('gas', 'n2o') }),
    num('ch4Ref', '700', undefined, undefined, { show: when('gas', 'n2o') }),
    num('lambda', '0.8'),
  ],
  solve(read) {
    const gas = read.pick('gas') as Gas;
    const [nowId, beforeId, otherId] = GAS_FIELDS[gas];
    const now = read.num(nowId);
    const before = read.num(beforeId);
    const other = otherId ? read.num(otherId) : 0;
    const lambda = read.num('lambda');
    check(lambda > 0, 'sensitivity');
    const df = forcing(gas, now, before, other);
    const dt = lambda * df;
    const doubling = 5.35 * Math.log(2);
    const vars = {
      now: fmt(now),
      before: fmt(before),
      other: fmt(other),
      df: fmt(df, 6),
      dt: fmt(dt, 6),
      lambda: fmt(lambda),
    };
    return {
      answer: word('a.forcing', vars),
      latex:
        gas === 'co2'
          ? `\\Delta F = 5.35 \\ln\\frac{C}{C_0} = 5.35 \\ln\\frac{${tex(now)}}{${tex(before)}} = ${tex(df)}\\ \\mathrm{W/m^2}`
          : `\\Delta F = ${gas === 'ch4' ? '0.036' : '0.12'}(\\sqrt{X} - \\sqrt{X_0}) - \\Delta f = ${tex(df)}\\ \\mathrm{W/m^2}`,
      rows: [
        [r('df'), `${vars.df} W/m²`],
        [r('dt'), `${vars.dt} K`],
        [r('ecs'), `${fmt(lambda * doubling, 5)} K`],
      ],
      steps: [word(`s.${gas}`, vars), word('s.response', vars)],
      source: word(gas === 'co2' ? 'sources.myhre' : 'sources.tar'),
    };
  },
};

const response: Mode = {
  id: 'response',
  label: 'kitEarth.climate.modes.response',
  intro: 'kitEarth.climate.intro.response',
  fields: [
    pick('boxes', ['two', 'one']),
    num('f', '3.7', 'power', 'W/m²'),
    num('ramp', '70'),
    num('lambda', '0.8'),
    num('mixed', '70', 'depth', 'm'),
    num('deep', '1000', 'depth', 'm', { show: when('boxes', 'two') }),
    num('gamma', '0.7', undefined, undefined, { show: when('boxes', 'two') }),
    num('years', '300'),
  ],
  solve(read) {
    const two = read.pick('boxes') === 'two';
    const f = read.num('f');
    const ramp = read.num('ramp');
    check(ramp >= 0, 'ramp');
    const model = {
      sensitivity: read.num('lambda'),
      upper: SEAWATER_HEAT * read.num('mixed'),
      deep: two ? SEAWATER_HEAT * read.num('deep') : 0,
      exchange: two ? read.num('gamma') : 0,
    };
    const years = read.num('years');
    const path = boxPath(model, rampForcing(f, ramp), years);
    const end = path.upper[path.upper.length - 1];
    const eq = model.sensitivity * f;
    const times = boxTimes(model);
    const vars = {
      end: fmt(end, 5),
      eq: fmt(eq, 5),
      share: fmt((100 * end) / eq, 4),
      years: fmt(years),
      c: fmt(model.upper, 4),
      times: times.map((v) => fmt(v, 4)).join(word('and')),
    };
    return {
      answer: word('a.response', vars),
      latex: two
        ? 'C\\frac{dT}{dt} = F - \\frac{T}{\\lambda} - \\gamma (T - T_D),\\quad C_D\\frac{dT_D}{dt} = \\gamma (T - T_D)'
        : 'C\\frac{dT}{dt} = F - \\frac{T}{\\lambda}',
      rows: [
        [r('end'), `${vars.end} K`],
        ...(two ? [[r('deepEnd'), `${fmt(path.deep[path.deep.length - 1], 5)} K`] as [string, string]] : []),
        [r('eq'), `${vars.eq} K`],
        [r('share'), `${vars.share}%`],
        [r('times'), `${vars.times} ${word('yr')}`],
      ],
      steps: [word(two ? 's.two' : 's.one', vars), word('s.rk4'), word('s.end', vars)],
      figures: [
        linePlot({
          title: word('plot.responseTitle'),
          description: word('plot.responseText', vars),
          xLabel: word('plot.years'),
          yLabel: word('plot.warming'),
          series: [
            { points: path.t.map((t, i) => [t, path.upper[i]] as const), label: word('plot.upper') },
            ...(two
              ? [{ points: path.t.map((t, i) => [t, path.deep[i]] as const), label: word('plot.deep'), dash: true }]
              : []),
          ],
          hlines: [{ y: eq, label: word('plot.equilibrium') }],
        }),
      ],
    };
  },
};

const ice: Mode = {
  id: 'ice',
  label: 'kitEarth.climate.modes.ice',
  intro: 'kitEarth.climate.intro.ice',
  fields: [
    num('q', '1'),
    num('s0', '1361', 'power', 'W/m²'),
    num('emissivity', '0.61'),
    num('iceAlbedo', '0.62'),
    num('warmAlbedo', '0.3'),
    num('iceT', '250', 'temperature', 'K'),
    num('warmT', '280', 'temperature', 'K'),
  ],
  solve(read) {
    const model = {
      s0: read.num('s0'),
      emissivity: read.num('emissivity'),
      iceAlbedo: read.num('iceAlbedo'),
      warmAlbedo: read.num('warmAlbedo'),
      iceT: read.num('iceT'),
      warmT: read.num('warmT'),
    };
    const q = read.num('q');
    check(q > 0, 'multiplier');
    const roots = equilibria(model, q);
    const tips = tippingPoints(model);
    const scan = hysteresis(model, 0.6, 1.6);
    const stateWord = (stable: boolean) => word(stable ? 'stable' : 'unstable');
    const list = roots.map((e) => `${fmt(e.t, 5)} K, ${stateWord(e.stable)}`).join('; ');
    const tip = (v: number | null) => (v === null ? word('none') : fmt(v, 4));
    const vars = {
      count: roots.length,
      list: list || word('none'),
      q: fmt(q),
      freeze: tip(tips.freeze),
      thaw: tip(tips.thaw),
    };
    const branch = (stable: boolean) =>
      scan.flatMap((s) => s.eq.filter((e) => e.stable === stable).map((e) => [s.q, e.t] as const));
    return {
      answer: word('a.ice', vars),
      latex: 'C\\frac{dT}{dt} = \\frac{qS_0}{4}(1 - \\alpha(T)) - \\varepsilon\\sigma T^4',
      rows: [
        ...roots.map((e, i): [string, string] => [word('r.state', { k: i + 1 }), `${K(e.t)}, ${stateWord(e.stable)}`]),
        [r('freeze'), vars.freeze],
        [r('thaw'), vars.thaw],
      ],
      steps: [word('s.ice'), word('s.roots', vars), word('s.stability'), word('s.tips', vars)],
      figures: [
        linePlot({
          title: word('plot.iceTitle'),
          description: word('plot.iceText', vars),
          xLabel: word('plot.multiplier'),
          yLabel: word('plot.temperatureK'),
          series: [
            { points: branch(true), label: word('stable'), dots: true },
            { points: branch(false), label: word('unstable'), dots: true, role: 's2' },
          ],
          vlines: [{ x: q }],
        }),
      ],
    };
  },
};

const ebm: Mode = {
  id: 'ebm',
  label: 'kitEarth.climate.modes.ebm',
  intro: 'kitEarth.climate.intro.ebm',
  fields: [
    num('s0', '1365', 'power', 'W/m²'),
    num('a', '210'),
    num('b', '2'),
    num('d', '0.555'),
    num('warmAlbedo', '0.3'),
    num('albedoP2', '0.25'),
    num('iceAlbedo', '0.62'),
    num('iceC', '-10', 'temperature', '°C'),
    pick('start', ['warm', 'cold']),
  ],
  solve(read) {
    const out = budykoSellers(
      {
        s0: read.num('s0'),
        a: read.num('a'),
        b: read.num('b'),
        d: read.num('d'),
        warmAlbedo: read.num('warmAlbedo'),
        albedoP2: read.num('albedoP2'),
        iceAlbedo: read.num('iceAlbedo'),
        iceT: read.num('iceC') - 273.15,
        s2: -0.48,
      },
      read.pick('start') as 'warm' | 'cold',
    );
    const deg = (x: number) => (Math.asin(x) * 180) / Math.PI;
    const vars = {
      mean: fmt(out.mean, 5),
      ice: out.iceLine >= 90 ? word('noIce') : out.iceLine <= 0 ? word('allIce') : `${fmt(out.iceLine, 4)}°`,
      equator: fmt(out.t[0], 5),
      pole: fmt(out.t[out.t.length - 1], 5),
    };
    return {
      answer: word('a.ebm', vars),
      latex: '-D\\frac{d}{dx}\\left[(1 - x^2)\\frac{dT}{dx}\\right] + A + BT = Q\\,s(x)\\,(1 - \\alpha(x, T))',
      rows: [
        [r('mean'), `${vars.mean} °C`],
        [r('iceLine'), vars.ice],
        [r('equator'), `${vars.equator} °C`],
        [r('pole'), `${vars.pole} °C`],
      ],
      steps: [word('s.ebm'), word('s.grid'), word('s.ebmEnd', vars)],
      figures: [
        linePlot({
          title: word('plot.ebmTitle'),
          description: word('plot.ebmText', vars),
          xLabel: word('plot.latitude'),
          yLabel: word('plot.temperatureC'),
          series: [{ points: out.x.map((x, i) => [deg(x), out.t[i]] as const) }],
          hlines: [{ y: read.num('iceC') - 273.15, label: word('plot.iceTemp') }],
          x: [0, 90],
        }),
      ],
    };
  },
};

const insolation: Mode = {
  id: 'insolation',
  label: 'kitEarth.climate.modes.insolation',
  intro: 'kitEarth.climate.intro.insolation',
  fields: [
    num('lat', '65'),
    pick('when', ['longitude', 'day']),
    num('longitude', '90', undefined, undefined, { show: when('when', 'longitude') }),
    num('day', '172', undefined, undefined, { show: when('when', 'day') }),
    num('s0', '1361', 'power', 'W/m²'),
    num('ecc', '0'),
    num('obliquity', '23.44'),
    num('perihelion', '102.9'),
  ],
  solve(read) {
    const orbit = {
      s0: read.num('s0'),
      eccentricity: read.num('ecc'),
      obliquity: read.num('obliquity'),
      perihelion: read.num('perihelion'),
    };
    const lat = read.num('lat');
    const lambda = read.pick('when') === 'day' ? solarLongitude(read.num('day'), orbit) : read.num('longitude');
    const out = dailyInsolation(lat, lambda, orbit);
    const vars = {
      q: fmt(out.q, 6),
      lat: fmt(lat),
      lambda: fmt(lambda, 5),
      delta: fmt(out.declination, 5),
      h0: fmt(out.hourAngle, 5),
      dist: fmt(out.distance, 6),
      hours: fmt(out.daylight, 4),
    };
    return {
      answer: word('a.insolation', vars),
      latex:
        `Q = \\frac{S_0}{\\pi}\\left(\\frac{d_0}{d}\\right)^2 (h_0 \\sin\\varphi\\sin\\delta + \\cos\\varphi\\cos\\delta\\sin h_0)` +
        ` = ${tex(out.q)}\\ \\mathrm{W/m^2}`,
      rows: [
        [r('q'), `${vars.q} W/m²`],
        [r('lambda'), `${vars.lambda}°`],
        [r('delta'), `${vars.delta}°`],
        [r('h0'), `${vars.h0}°`],
        [r('hours'), `${vars.hours} h`],
        [r('dist'), vars.dist],
        [r('annual'), `${fmt(annualMean(lat, orbit), 5)} W/m²`],
      ],
      steps: [
        word('s.delta', vars),
        word(out.hourAngle === 0 ? 's.night' : out.hourAngle === 180 ? 's.day' : 's.h0', vars),
        word('s.dist', vars),
        word('s.q', vars),
      ],
      figures: [
        linePlot({
          title: word('plot.latTitle'),
          description: word('plot.latText', vars),
          xLabel: word('plot.latitudeSigned'),
          yLabel: word('plot.insolation'),
          series: [{ points: latitudesAt(lambda, orbit) }],
          vlines: [{ x: lat }],
          x: [-90, 90],
        }),
        linePlot({
          title: word('plot.yearTitle'),
          description: word('plot.yearText', vars),
          xLabel: word('plot.day'),
          yLabel: word('plot.insolation'),
          series: [{ points: yearAt(lat, orbit) }],
          x: [1, 365],
        }),
      ],
      source: word('sources.berger'),
    };
  },
};

export const CLIMATE_MODES: readonly Mode[] = [balance, forcingMode, response, ice, ebm, insolation, ...LAND_MODES];
