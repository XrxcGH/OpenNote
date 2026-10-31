// The atmospheric thermodynamics calculations as forms. They cover humidity, the LCL, lapse rates, thickness, a
// Skew-T with parcels, indices, and winds, CAPE from a table, room humidity for collections, and salt solutions.
import '../text';
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { check } from '../core/problem';
import { numberRows } from '../core/rows';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import { looseT } from '../ui/form';
import { skewT, hodograph } from './skewt';
import { checkSounding, components, indices, liftParcel, winds } from './sounding';
import type { Level, ParcelKind } from './sounding';
import {
  DRY_LAPSE,
  SALTS,
  T0,
  capeTrapezoids,
  dewPoint,
  esIce,
  esWater,
  frostPoint,
  lclPressure,
  lclRomps,
  lclTemperatureBolton,
  mixingRatio,
  moistAdiabat,
  moistLapse,
  potentialTemperature,
  saltHumidity,
  specificHumidity,
  thetaE,
  thickness,
  vaporFromMixing,
  virtualTemperature,
  wetBulb,
} from './thermo';
import type { Formula, Salt } from './thermo';

const { num, pick, text, r } = fieldsFor('moist');
const word = (key: string, vars?: Readonly<Record<string, string | number>>) => looseT(`kitEarth.moist.${key}`, vars);
const c = (k: number) => fmt(k - T0, 6);

const humidity: Mode = {
  id: 'humidity',
  label: 'kitEarth.moist.modes.humidity',
  fields: [
    num('t', '20', 'temperature', '°C'),
    pick('given', ['rh', 'td', 'w']),
    num('rh', '50', undefined, undefined, { show: when('given', 'rh') }),
    num('td', '9.27', 'temperature', '°C', { show: when('given', 'td') }),
    num('w', '7.35', 'mixing', 'g/kg', { show: when('given', 'w') }),
    num('p', '1000', 'pressure', 'hPa'),
    pick('formula', ['bolton', 'magnus']),
  ],
  solve(read) {
    const temp = read.num('t');
    const p = read.num('p');
    const formula = read.pick('formula') as Formula;
    const es = esWater(temp, formula);
    const given = read.pick('given');
    let e: number;
    if (given === 'rh') {
      const rh = read.num('rh');
      check(rh > 0 && rh <= 100, 'rh');
      e = (rh / 100) * es;
    } else if (given === 'td') e = esWater(read.num('td'), formula);
    else {
      const w = read.num('w');
      check(w > 0, 'mixingPositive');
      e = vaporFromMixing(w, p);
    }
    check(e <= es * (1 + 1e-9), 'supersaturated');
    const w = mixingRatio(e, p);
    const td = dewPoint(e, formula);
    const tw = wetBulb(temp, Math.min(td, temp), p, formula);
    const tv = virtualTemperature(temp, w);
    const theta = potentialTemperature(temp, p);
    const vars = {
      rh: fmt((100 * e) / es, 5),
      w: fmt(1000 * w, 6),
      td: c(td),
      es: fmt(es / 100, 6),
      e: fmt(e / 100, 6),
    };
    return {
      answer: t('kitEarth.moist.a.humidity', vars),
      latex:
        `e_s = 6.112\\,e^{17.67T/(T + 243.5)} = ${tex(es / 100)}\\ \\mathrm{hPa},\\quad ` +
        `w = \\frac{0.622\\,e}{p - e} = ${tex(1000 * w)}\\ \\mathrm{g/kg}`,
      rows: [
        [r('es'), `${vars.es} hPa`],
        [r('esIce'), temp < T0 ? `${fmt(esIce(temp) / 100, 6)} hPa` : '—'],
        [r('e'), `${vars.e} hPa`],
        [r('rh'), `${vars.rh}%`],
        [r('w'), `${vars.w} g/kg`],
        [r('q'), `${fmt(1000 * specificHumidity(w), 6)} g/kg`],
        [r('td'), `${vars.td} °C`],
        [r('frost'), td < T0 ? `${c(frostPoint(e))} °C` : '—'],
        [r('tw'), `${c(tw)} °C`],
        [r('tv'), `${fmt(tv, 6)} K`],
        [r('theta'), `${fmt(theta, 6)} K`],
        [r('thetaV'), `${fmt(potentialTemperature(tv, p), 6)} K`],
        [r('thetaE'), `${fmt(thetaE(temp, Math.min(td, temp), p, formula), 6)} K`],
      ],
      steps: [
        t(formula === 'bolton' ? 'kitEarth.moist.s.esBolton' : 'kitEarth.moist.s.esMagnus', {
          t: c(temp),
          es: vars.es,
        }),
        t('kitEarth.moist.s.e', vars),
        t('kitEarth.moist.s.w', { ...vars, p: fmt(p / 100) }),
        t('kitEarth.moist.s.td', vars),
        t('kitEarth.moist.s.tw', { tw: c(tw) }),
        t('kitEarth.moist.s.tv', { tv: fmt(tv, 6) }),
      ],
    };
  },
};

const lcl: Mode = {
  id: 'lcl',
  label: 'kitEarth.moist.modes.lcl',
  fields: [
    num('t', '30', 'temperature', '°C'),
    num('td', '20', 'temperature', '°C'),
    num('p', '1000', 'pressure', 'hPa'),
    pick('method', ['bolton', 'romps']),
  ],
  solve(read) {
    const temp = read.num('t');
    const td = read.num('td');
    const p = read.num('p');
    const romps = read.pick('method') === 'romps';
    const tb = lclTemperatureBolton(temp, td);
    const exact = romps ? lclRomps(p, temp, esWater(td) / esWater(temp)) : null;
    const tl = exact ? exact.t : tb;
    const pl = exact ? exact.p : lclPressure(temp, p, tb);
    const zl = exact ? exact.z : (temp - tb) / DRY_LAPSE;
    const vars = {
      tl: fmt(tl, 6),
      tlc: c(tl),
      pl: fmt(pl / 100, 6),
      zl: fmt(zl, 5),
      thetaE: fmt(thetaE(temp, td, p), 6),
    };
    return {
      answer: t('kitEarth.moist.a.lcl', vars),
      latex: `T_L = \\frac{1}{\\frac{1}{T_d - 56} + \\frac{\\ln(T/T_d)}{800}} + 56 = ${tex(tb)}\\ \\mathrm{K}`,
      rows: [
        [r('tl'), `${vars.tl} K (${vars.tlc} °C)`],
        [r('pl'), `${vars.pl} hPa`],
        [r('zl'), `${vars.zl} m`],
        [r('theta'), `${fmt(potentialTemperature(temp, p), 6)} K`],
        [r('thetaE'), `${vars.thetaE} K`],
      ],
      steps: [
        t(romps ? 'kitEarth.moist.s.romps' : 'kitEarth.moist.s.bolton', vars),
        t('kitEarth.moist.s.pl', vars),
        t('kitEarth.moist.s.thetaE', vars),
      ],
    };
  },
};

const lapse: Mode = {
  id: 'lapse',
  label: 'kitEarth.moist.modes.lapse',
  fields: [
    num('t', '20', 'temperature', '°C'),
    num('p', '1000', 'pressure', 'hPa'),
    num('p2', '500', 'pressure', 'hPa'),
  ],
  solve(read) {
    const temp = read.num('t');
    const p = read.num('p');
    const p2 = read.num('p2');
    const moist = moistLapse(temp, p);
    const along = moistAdiabat(temp, p, p2);
    const dry = temp * (p2 / p) ** 0.2857;
    const vars = {
      dry: fmt(DRY_LAPSE * 1000, 5),
      moist: fmt(moist * 1000, 5),
      along: c(along),
      dryT: c(dry),
      p2: fmt(p2 / 100),
    };
    return {
      answer: t('kitEarth.moist.a.lapse', vars),
      latex: `\\Gamma_m = g\\frac{1 + L_v r_s/(R_d T)}{c_p + L_v^2 r_s \\varepsilon/(R_d T^2)} = ${tex(moist * 1000)}\\ \\mathrm{K/km}`,
      rows: [
        [r('dry'), `${vars.dry} K/km`],
        [r('moist'), `${vars.moist} K/km`],
        [r('alongMoist'), `${vars.along} °C`],
        [r('alongDry'), `${vars.dryT} °C`],
      ],
      steps: [
        t('kitEarth.moist.s.dry', vars),
        t('kitEarth.moist.s.moist', vars),
        t('kitEarth.moist.s.integrate', vars),
      ],
    };
  },
};

const thick: Mode = {
  id: 'thickness',
  label: 'kitEarth.moist.modes.thickness',
  fields: [
    num('p1', '1000', 'pressure', 'hPa'),
    num('p2', '500', 'pressure', 'hPa'),
    num('tv', '270', 'temperature', 'K'),
  ],
  solve(read) {
    const p1 = read.num('p1');
    const p2 = read.num('p2');
    const tv = read.num('tv');
    const dz = thickness(p1, p2, tv);
    const vars = { dz: fmt(dz, 6), tv: fmt(tv), p1: fmt(p1 / 100), p2: fmt(p2 / 100) };
    return {
      answer: t('kitEarth.moist.a.thickness', vars),
      latex: `\\Delta z = \\frac{R_d \\bar T_v}{g}\\ln\\frac{p_1}{p_2} = ${tex(dz)}\\ \\mathrm{m}`,
      rows: [[r('dz'), `${vars.dz} m`]],
      steps: [t('kitEarth.moist.s.thickness', vars)],
    };
  },
};

const SOUNDING =
  '1000, 110, 30, 22, 170, 10\n950, 560, 26, 20, 190, 20\n900, 1030, 22.5, 18, 210, 25\n850, 1520, 19, 15, 230, 30\n' +
  '700, 3110, 8, -2, 250, 35\n600, 4290, 0, -12, 260, 40\n500, 5650, -9, -25, 265, 50\n400, 7260, -20, -38, 270, 60\n' +
  '300, 9300, -35, -50, 270, 70\n250, 10550, -44, -58, 270, 75\n200, 12000, -54, -65, 270, 70\n150, 13800, -60, -75, 270, 60\n' +
  '100, 16300, -66, -85, 270, 40';

const skew: Mode = {
  id: 'skewt',
  label: 'kitEarth.moist.modes.skewt',
  intro: 'kitEarth.moist.intro.skewt',
  fields: [
    text('sounding', SOUNDING, 'area', { rows: 8 }),
    pick('parcel', ['surface', 'mixed', 'unstable']),
    pick('speed', ['kt', 'ms']),
  ],
  solve(read) {
    const scale = read.pick('speed') === 'kt' ? 0.514444 : 1;
    const rows = numberRows(read.raw('sounding'), 4, 6);
    const levels: Level[] = checkSounding(
      rows.map((row) => {
        const wind = row.length >= 6 ? components(row[4], row[5] * scale) : null;
        return {
          p: row[0] * 100,
          z: row[1],
          t: row[2] + T0,
          td: row[3] + T0,
          u: wind ? wind[0] : null,
          v: wind ? wind[1] : null,
        };
      }),
    );
    const parcel = liftParcel(levels, read.pick('parcel') as ParcelKind);
    const idx = indices(levels, parcel);
    const wind = winds(levels);
    const hpa = (p: number | null) => (p === null ? word('none') : `${fmt(p / 100, 4)} hPa`);
    const vars = {
      cape: fmt(parcel.cape, 4),
      cin: fmt(parcel.cin, 3),
      lcl: fmt(parcel.lcl.p / 100, 4),
      lfc: hpa(parcel.lfc),
      el: hpa(parcel.el),
    };
    const kt = (uv: [number, number] | null) => {
      if (!uv) return word('none');
      const speed = Math.hypot(uv[0], uv[1]);
      const from = ((Math.atan2(-uv[0], -uv[1]) * 180) / Math.PI + 360) % 360;
      return `${fmt(from, 3)}° ${fmt(speed / 0.514444, 3)} kt`;
    };
    const figures = [
      skewT(levels, parcel, {
        title: t('kitEarth.moist.plot.skewTitle'),
        description: t('kitEarth.moist.plot.skewText', { count: levels.length, ...vars }),
        pressure: t('kitEarth.moist.plot.pressure'),
        temperature: t('kitEarth.moist.plot.temperature'),
      }),
    ];
    if (levels.some((l) => l.u !== null))
      figures.push(
        hodograph(
          levels,
          [
            ...(wind.right ? [{ at: wind.right, label: t('kitEarth.moist.plot.right') }] : []),
            ...(wind.left ? [{ at: wind.left, label: t('kitEarth.moist.plot.left') }] : []),
          ],
          {
            title: t('kitEarth.moist.plot.hodoTitle'),
            description: t('kitEarth.moist.plot.hodoText', {
              srh: wind.srh === null ? word('none') : fmt(wind.srh, 4),
            }),
            u: t('kitEarth.moist.plot.u'),
            v: t('kitEarth.moist.plot.v'),
          },
        ),
      );
    return {
      answer: t('kitEarth.moist.a.skewt', vars),
      rows: [
        [r('parcel'), word(`o.${parcel.kind}`)],
        [r('lclP'), `${vars.lcl} hPa (${c(parcel.lcl.t)} °C)`],
        [r('lfc'), vars.lfc],
        [r('el'), vars.el],
        [r('cape'), `${vars.cape} J/kg`],
        [r('cin'), `${vars.cin} J/kg`],
        [r('li'), idx.lifted === null ? word('none') : `${fmt(idx.lifted, 3)} K`],
        [r('k'), idx.k === null ? word('none') : fmt(idx.k, 3)],
        [r('totals'), idx.totals === null ? word('none') : fmt(idx.totals, 3)],
        [r('pw'), `${fmt(idx.water, 4)} mm`],
        [r('shear'), wind.shear === null ? word('none') : `${fmt(wind.shear / 0.514444, 3)} kt`],
        [r('right'), kt(wind.right)],
        [r('left'), kt(wind.left)],
        [r('srh'), wind.srh === null ? word('none') : `${fmt(wind.srh, 4)} m²/s²`],
      ],
      steps: [
        t(
          `kitEarth.moist.s.parcel${parcel.kind === 'surface' ? 'Surface' : parcel.kind === 'mixed' ? 'Mixed' : 'Unstable'}`,
        ),
        t('kitEarth.moist.s.lift', vars),
        t('kitEarth.moist.s.cape', vars),
        t('kitEarth.moist.s.indices'),
        t('kitEarth.moist.s.winds'),
      ],
      figures,
    };
  },
};

const capeMode: Mode = {
  id: 'cape',
  label: 'kitEarth.moist.modes.cape',
  intro: 'kitEarth.moist.intro.cape',
  fields: [text('layers', '900, 0\n800, 2\n700, 3\n600, 2\n500, 0', 'area', { rows: 5 })],
  solve(read) {
    const rows = numberRows(read.raw('layers'), 2);
    const out = capeTrapezoids(
      rows.map((row) => row[0]),
      rows.map((row) => row[1]),
    );
    const vars = { cape: fmt(out.cape, 6), cin: fmt(out.cin, 4), count: rows.length };
    return {
      answer: t('kitEarth.moist.a.cape', vars),
      latex:
        `\\mathrm{CAPE} = R_d \\sum \\tfrac12 (\\Delta T_{v,i} + \\Delta T_{v,i+1}) \\ln\\frac{p_i}{p_{i+1}}` +
        ` = ${tex(out.cape)}\\ \\mathrm{J/kg}`,
      rows: [
        [r('cape'), `${vars.cape} J/kg`],
        [r('cin'), `${vars.cin} J/kg`],
      ],
      steps: [t('kitEarth.moist.s.trapezoids', vars)],
    };
  },
};

const indoor: Mode = {
  id: 'indoor',
  label: 'kitEarth.moist.modes.indoor',
  intro: 'kitEarth.moist.intro.indoor',
  fields: [
    num('t1', '20', 'temperature', '°C'),
    num('rh1', '50'),
    num('t2', '15', 'temperature', '°C'),
    num('surface', '8', 'temperature', '°C'),
  ],
  solve(read) {
    const t1 = read.num('t1');
    const rh1 = read.num('rh1');
    check(rh1 > 0 && rh1 <= 100, 'rh');
    const e = (rh1 / 100) * esWater(t1);
    const t2 = read.num('t2');
    const rh2 = (100 * e) / esWater(t2);
    const td = dewPoint(e);
    const surface = read.num('surface');
    const wet = surface <= td;
    const vars = { rh2: fmt(Math.min(rh2, 100), 4), td: c(td), surface: c(surface) };
    return {
      answer: t(rh2 > 100 ? 'kitEarth.moist.a.indoorSaturated' : 'kitEarth.moist.a.indoor', vars),
      rows: [
        [r('rh2'), rh2 > 100 ? word('saturated') : `${vars.rh2}%`],
        [r('td'), `${vars.td} °C`],
        [r('surface'), t(wet ? 'kitEarth.moist.r.wet' : 'kitEarth.moist.r.noCondensation')],
      ],
      steps: [
        t('kitEarth.moist.s.same', { e: fmt(e / 100, 5) }),
        t('kitEarth.moist.s.rh2', vars),
        t('kitEarth.moist.s.surface', vars),
      ],
    };
  },
};

const SALT_IDS = Object.keys(SALTS) as Salt[];

const salts: Mode = {
  id: 'salts',
  label: 'kitEarth.moist.modes.salts',
  intro: 'kitEarth.moist.intro.salts',
  fields: [pick('salt', SALT_IDS), num('celsius', '25')],
  solve(read) {
    const salt = read.pick('salt') as Salt;
    const celsius = read.num('celsius');
    const rh = saltHumidity(salt, celsius);
    const vars = { salt: word(`formula.${salt}`), rh: fmt(rh, 4), t: fmt(celsius) };
    return {
      answer: t('kitEarth.moist.a.salt', vars),
      table: {
        header: [r('salt'), r('rhAt')],
        rows: SALT_IDS.map((s) => [word(`o.${s}`), `${fmt(saltHumidity(s, celsius), 4)}%`]),
      },
      steps: [t('kitEarth.moist.s.salt', vars)],
      source: t('kitEarth.moist.sources.greenspan'),
    };
  },
};

export const MOIST_MODES: readonly Mode[] = [humidity, lcl, lapse, thick, skew, capeMode, indoor, salts];
