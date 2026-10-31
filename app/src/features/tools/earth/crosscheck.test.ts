// Cross-check across the kit. Expected values are computed here from published formulas or
// published check values, independently of the kit's code.
import { describe, expect, it } from 'vitest';
import * as E from './climate/energy';
import * as I from './climate/insolation';
import * as C from './climate/classify';
import * as W from './climate/water';
import * as F from './climate/footprint';
import * as SW from './ocean/seawater';
import * as RO from './ocean/rotating';
import * as WV from './ocean/waves';
import * as S from './seismic/engine';
import * as Q from './air/quality';
import { decodeMetar, decodeTaf } from './air/metar';
import * as GR from './geophysics/gravity';
import * as SP from './geophysics/sphere';
import * as LY from './geophysics/layers';
import * as GEO from './stereonet/geometry';
import * as ST from './stereonet/stats';
import * as D from './dating/decay';
import * as ISO from './dating/isotopes';
import { york } from './dating/york';
import * as TH from './moist/thermo';
import * as TER from './geodiagrams/ternary';
import { parseRelations, buildMatrix } from './geodiagrams/harris';

const SIG = 5.670374419e-8;
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);

describe('climate energy', () => {
  it('energy balance', () => {
    near(E.effectiveTemperature(1361, 0.3), 254.578, 1e-3);
    // Mars: S0 586.2, albedo 0.25
    near(E.effectiveTemperature(586.2, 0.25), ((586.2 * 0.75) / (4 * SIG)) ** 0.25, 1e-9);
    near(E.layerTemperatures(255, 2).surface, 3 ** 0.25 * 255, 1e-9);
    near(E.leakyLayer(255, 0.78).surface, 255 * (2 / 1.22) ** 0.25, 1e-9);
    near(E.forcing('co2', 420, 280), 5.35 * Math.log(1.5), 1e-9);
    // TAR table 6.2 CH4 1750->1998: 700 -> 1745 ppb, N2O 270: 0.48; N2O 270 -> 314: 0.15
    near(E.forcing('ch4', 1745, 700, 270), 0.48, 0.01);
    near(E.forcing('n2o', 314, 270, 700), 0.15, 0.01);
  });
  it('box model analytic two-box steady state and one-box ramp', () => {
    const one = { sensitivity: 0.8, upper: E.SEAWATER_HEAT * 100, deep: 0, exchange: 0 };
    const tau = (E.SEAWATER_HEAT * 100 * 0.8) / (365.25 * 86400);
    // ramp F = 3.7 t/70 for 70 years: T(t) = λ a (t − τ(1 − e^{−t/τ}))
    const path = E.boxPath(one, E.rampForcing(3.7, 70), 70);
    const end = path.upper[path.upper.length - 1];
    near(end, 0.8 * (3.7 / 70) * (70 - tau * (1 - Math.exp(-70 / tau))), 1e-6);
  });
  it('ice albedo equilibria closed forms', () => {
    const m: E.IceAlbedo = { s0: 1361, emissivity: 0.61, iceAlbedo: 0.62, warmAlbedo: 0.3, iceT: 250, warmT: 280 };
    const roots = E.equilibria(m, 1);
    near(roots[0].t, ((1361 * 0.38) / (4 * 0.61 * SIG)) ** 0.25, 1e-6);
  });
  it('Budyko-Sellers: no diffusion gives local balance; with diffusion the hemispheric mean balances', () => {
    const base = {
      s0: 1361,
      a: 210,
      b: 2,
      d: 0,
      warmAlbedo: 0.3,
      albedoP2: 0.25,
      iceAlbedo: 0.62,
      iceT: -10,
      s2: -0.482,
    };
    const r = E.budykoSellers(base, 'warm');
    r.x.forEach((x, i) => {
      const p2 = (3 * x * x - 1) / 2;
      const alb = r.t[i] < -10 ? 0.62 : 0.3 + 0.25 * p2;
      near(r.t[i], ((1361 / 4) * (1 + -0.482 * p2) * (1 - alb) - 210) / 2, 1e-6);
    });
    const d = E.budykoSellers({ ...base, d: 0.555 }, 'warm');
    const rhs =
      d.x.reduce((s, x, i) => {
        const p2 = (3 * x * x - 1) / 2;
        const alb = d.t[i] < -10 ? 0.62 : 0.3 + 0.25 * p2;
        return s + (1361 / 4) * (1 + -0.482 * p2) * (1 - alb);
      }, 0) / d.x.length;
    near(d.mean, (rhs - 210) / 2, 1e-6);
  });
});

describe('climate insolation and classes', () => {
  it('insolation', () => {
    const today: I.Orbit = { s0: 1361, eccentricity: 0.0167, obliquity: 23.44, perihelion: 102.9 };
    const circ = { ...today, eccentricity: 0 };
    near(I.dailyInsolation(65, 90, circ).q, 493.623, 1e-3);
    // eccentric orbit: distance factor at λ = 90
    const e = 0.0167;
    const dist = (1 + e * Math.cos(((90 - 282.9) * Math.PI) / 180)) ** 2 / (1 - e * e) ** 2;
    near(I.dailyInsolation(65, 90, today).q, 493.623 * dist, 2e-3);
    // global annual mean = S0/4 (cos-weighted average over latitudes)
    let num = 0;
    let den = 0;
    for (let lat = -89; lat <= 89; lat += 2) {
      const w = Math.cos((lat * Math.PI) / 180);
      num += w * I.annualMean(lat, today);
      den += w;
    }
    near(num / den, 1361 / 4, 0.5);
    // June solstice day for today's orbit: about June 21 (day 172)
    let day = 80;
    while (I.solarLongitude(day, today) < 90) day += 0.05;
    near(day, 172.3, 1.0);
    // Perihelion about Jan 3 (day 3): λ = 282.9
    let dp = 300;
    while (I.solarLongitude(dp, today) < 282.9 && dp < 370) dp += 0.05;
    near(dp - 365, 3, 1.5);
  });
  it('Köppen extra cases', () => {
    const k = (t: number[], p: number[], south = false) => C.koppen({ t, p, south }).code;
    expect(
      k(
        [-6.5, -6.7, -1, 6.7, 13.2, 17, 19.2, 17, 11.3, 5.6, -1.2, -5.2],
        [52, 41, 35, 37, 49, 80, 85, 82, 68, 71, 55, 52],
      ),
    ).toBe('Dfb');
    expect(k(Array(12).fill(26), [5, 5, 10, 40, 150, 200, 250, 250, 200, 100, 20, 5])).toBe('Aw');
    expect(k([0, 2, 7, 13, 18, 23, 26, 25, 20, 13, 6, 1], [10, 12, 20, 25, 30, 20, 15, 15, 20, 20, 15, 10])).toBe(
      'BSk',
    );
    expect(k([4, 4, 6, 9, 12, 15, 17, 17, 14, 11, 7, 5], Array(12).fill(60))).toBe('Cfb');
    // Dwa: Beijing-like
    expect(
      k(
        [-3.1, 0.3, 6.7, 14.8, 20.8, 24.9, 26.7, 25.5, 20.7, 13.7, 5, -0.9],
        [3, 5, 9, 25, 36, 73, 170, 150, 50, 24, 9, 3],
      ),
    ).toBe('Dwa');
    // Dfd Yakutsk-like
    expect(
      k(
        [-38.6, -33.8, -20.1, -4.8, 7.5, 16.4, 19.5, 15.2, 6.1, -7.8, -27, -37.6],
        [9, 7, 6, 9, 19, 37, 39, 39, 30, 19, 15, 12],
      ),
    ).toBe('Dfd');
    // Cwb vs Cwc: 3 months >= 10 -> c
    expect(k([2, 3, 5, 8, 11, 12, 11, 9, 7, 5, 3, 2], [10, 10, 10, 30, 80, 120, 150, 140, 90, 30, 10, 10])).toBe('Cwc');
  });
  it('Holdridge', () => {
    const h = (b: number, p: number) => {
      const z = C.holdridge(b, p);
      return `${z.belt}/${z.zone}/${z.province}`;
    };
    expect(h(20, 1500)).toBe('subtropical/moistForest/humid');
    expect(h(16, 1500)).toBe('warmTemperate/moistForest/humid');
    expect(h(2, 200)).toBe('subpolar/moistTundra/humid');
    expect(h(25, 1500)).toBe('tropical/dryForest/subhumid');
    expect(h(4.5, 90)).toBe('boreal/desert/semiarid');
  });
});

describe('climate water and footprint', () => {
  it('Thornthwaite and water balance', () => {
    const t = Array(12).fill(20);
    const i = W.heatIndex(t);
    near(i, 12 * 4 ** 1.514, 1e-9);
    const a = W.exponentA(i);
    near(W.petUnadjusted(20, i, a), 16 * (200 / i) ** a, 1e-9);
    // Cooper day length 40N, day 197
    const delta = ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + 197)) / 365);
    const N = (24 / Math.PI) * Math.acos(-Math.tan((40 * Math.PI) / 180) * Math.tan(delta));
    near(W.dayLength(40, 197), N, 1e-9);
    expect(W.dayLength(89, 172)).toBe(24);
    expect(W.dayLength(-89, 172)).toBe(0);
    const bal = W.waterBalance(t, Array(12).fill(0), 40, 100);
    // all dry: storage decays S exp(-PET/100) each month; a repeating year settles at 0
    expect(bal.months[11].storage).toBeLessThan(1e-3);
    near(bal.months[6].pet, (W.petUnadjusted(20, i, a) * N * 31) / 360, 1e-9);
    // one dry month after full: PET 60, P 10 -> S = 100 e^{-0.5}
    const t2 = [...t];
    const p2 = Array(12).fill(200);
    p2[6] = 0;
    const b2 = W.waterBalance(t2, p2, 0, 100);
    const pet = b2.months[6].pet;
    near(b2.months[6].storage, 100 * Math.exp(-pet / 100), 1e-9);
    near(b2.months[6].aet, 100 - 100 * Math.exp(-pet / 100), 1e-9);
    expect(W.degreeDays([-5, 30], 18)).toEqual({ heating: 23, cooling: 12 });
    expect(W.degreeDays([65, 50, 80], 65)).toEqual({ heating: 15, cooling: 15 });
  });
  it('footprint', () => {
    const out = F.footprint(
      F.readActivities(
        '100 gal gasoline\n12, 53.06, 1\n500, 0.3734, 2\n2, 1000, 3 flights'.replace('100 gal gasoline\n', ''),
      ),
    );
    near(out.total, 12 * 53.06 + 500 * 0.3734 + 2000, 1e-9);
    near(F.toPounds(400), 881.849, 1e-3);
    // header row skipped
    expect(F.readActivities('amount,factor,scope\n1,2,3').length).toBe(1);
  });
});

describe('ocean', () => {
  it('EOS-80 check values (UNESCO 1983)', () => {
    near(SW.density(35, 5, 0), 1027.67547, 1e-5);
    near(SW.density(35, 25, 10000), 1062.53817, 1e-5);
    near(SW.density(0, 5, 0), 999.96675, 1e-5);
    near(SW.density(0, 25, 10000), 1037.90204, 1e-5);
    near(SW.density(35, 25, 0), 1023.34306, 1e-5);
    near(SW.soundSpeed(40, 40, 10000), 1731.995, 1e-3);
    near(SW.potentialTemperature(40, 40, 10000, 0), 36.89073, 1e-5);
    near(SW.lapseRate(40, 40, 10000), 3.255976e-4, 1e-10);
    near(SW.freezingPoint(40, 500), -2.588567, 1e-6);
    near(SW.mackenzie(10, 35, 1000), 1506.264, 1e-3);
    // Mackenzie formula by hand at 25 C, 35, 1000 m
    const t = 25,
      dd = 1000;
    near(
      SW.mackenzie(25, 35, dd),
      1448.96 +
        4.591 * t -
        5.304e-2 * t * t +
        2.374e-4 * t ** 3 +
        1.63e-2 * dd +
        1.675e-7 * dd * dd -
        7.139e-13 * t * dd ** 3,
      1e-9,
    );
    near(SW.sigmaTheta(35, 5), 27.67547, 1e-5);
    near(SW.isopycnalTemperature(35, 27.67547)!, 5, 1e-4);
  });
  it('rotating and waves', () => {
    const c = RO.coriolis(45);
    near(c.f, 2 * 7.292115e-5 * Math.SQRT1_2, 1e-12);
    near(c.period / 3600, 16.9242, 1e-4);
    near(RO.geostrophicFromHeight(60, 600e3, c.f), 9.50938, 1e-4);
    near(RO.thermalWind(1000, 500, 10, 1e6, 1e-4), (287.05 / 1e-4) * Math.LN2 * 1e-5, 1e-9);
    near(RO.gradientWind(20, 500e3, 1e-4), -25 + Math.sqrt(625 + 1000), 1e-9);
    near(RO.deformation(0.01, 1000, 1e-4).baroclinic, 100e3, 1e-6);
    near(RO.ekman(0.1, 1025, 1e-4, 0.01).transport, 0.97561, 1e-5);
    near(RO.ekman(0.1, 1025, 1e-4, 0.01).depth, Math.PI * Math.sqrt(200), 1e-9);
    const rw = RO.rossbyWave(1.6e-11, (2 * Math.PI) / 4e6, 0, 1e9);
    near(rw.phaseX, -1.6e-11 / ((2 * Math.PI) / 4e6) ** 2, 1e-5);
    // waves: independent bisection for x tanh x = y
    const solve = (T: number, h: number) => {
      const y = (((2 * Math.PI) / T) ** 2 * h) / 9.80665;
      let lo = 0,
        hi = 50;
      for (let i = 0; i < 200; i++) {
        const m = (lo + hi) / 2;
        if (m * Math.tanh(m) < y) lo = m;
        else hi = m;
      }
      return (2 * Math.PI * h) / lo;
    };
    near(WV.dispersion(10, 20).length, 121.21, 1e-2);
    near(WV.dispersion(10, 20).length, solve(10, 20), 1e-6);
    near(WV.dispersion(8, 5).length, solve(8, 5), 1e-6);
    near(WV.dispersion(4, 500).length, (9.80665 * 16) / (2 * Math.PI), 1e-6);
    near(WV.dispersion(100, 1).phase, Math.sqrt(9.80665), 1e-3);
    near(WV.energy(2, 5).energy, (1025 * 9.80665 * 4) / 8, 1e-9);
    const sh = WV.shoal(10, 2, 30, 5);
    const loc = WV.dispersion(10, 5);
    near(Math.sin((sh.angle * Math.PI) / 180), (0.5 * loc.phase) / ((9.80665 * 10) / (2 * Math.PI)), 1e-9);
    near(sh.ks, Math.sqrt((9.80665 * 10) / (4 * Math.PI) / loc.group), 1e-9);
    near(WV.breaking(2).depth, 2 / 0.78, 1e-9);
  });
});

describe('seismic', () => {
  it('cases', () => {
    near(S.spDistance(10, 6, 3.5), 84, 1e-9);
    near(S.magnitude(1e20).mw, 7.26667, 1e-5);
    near(S.magnitude(1e20).logEnergy, 15.7, 1e-5);
    near(S.bValue([2.0, 2.1, 2.3, 2.5, 2.2, 3.0, 2.4, 2.8, 2.0, 2.6], 2.0, 0.1).b, 0.987033, 1e-6);
    const r = S.refraction(1500, 4000, 20);
    near(r.crossover, 59.3296, 1e-4);
    near(r.intercept, 0.0247207, 1e-6);
    near(r.critical, 16.1808, 1e-4);
    near(S.depthFromIntercept(r.intercept, 1500, 4000), 20, 1e-9);
    near(S.nmo(1, 1000, 2000).t, 1.11803, 1e-5);
    near(S.dix(1, 2000, 1.5, 2500).speed, 3278.72, 1e-2);
    const ws = S.waveSpeeds(130e9, 80e9, 3300);
    near(ws.vp, Math.sqrt((130e9 + (4 / 3) * 80e9) / 3300), 1e-9);
    near(ws.poisson, 230 / 940, 1e-12);
    // Wadati synthetic: origin 10 s, Vp 6, Vs 6/1.75
    const d = [30, 60, 90];
    const w = S.wadati(d.map((x) => [10 + x / 6, 10 + x / (6 / 1.75)] as const));
    near(w.origin, 10, 1e-9);
    near(w.ratio, 1.75, 1e-9);
    // locate synthetic: source (12, -7) origin 3 s, v 6
    const src = { x: 12, y: -7, t: 3 };
    const st = [
      [0, 0],
      [50, 0],
      [0, 50],
      [40, 60],
      [-30, 20],
    ].map(([x, y]) => ({ x, y, t: src.t + Math.hypot(x - src.x, y - src.y) / 6 }));
    const loc = S.locate(st, 6);
    near(loc.x, 12, 1e-6);
    near(loc.y, -7, 1e-6);
    near(loc.origin, 3, 1e-6);
    // moment of Mw 9.0 = 3.98e22
    near(Math.log10(S.momentOf(9)), 22.6, 1e-9);
  });
});

describe('air', () => {
  it('AQI', () => {
    expect(Q.aqi('pm25', 20).index).toBe(71);
    expect(Q.aqi('o3_8', 0.065).index).toBe(84);
    expect(Q.aqi('pm25', 35.45).index).toBe(100);
    expect(Q.aqi('pm25', 35.5).index).toBe(101);
    expect(Q.aqi('pm25', 9.05).index).toBe(50);
    expect(Q.aqi('pm25', 55.5).index).toBe(151);
    expect(Q.aqi('co', 9.45).index).toBe(100);
    expect(Q.aqi('no2', 100.6).index).toBe(100);
    expect(Q.aqi('pm10', 154.9).index).toBe(100);
    expect(Q.aqi('o3_8', 0.0709).index).toBe(100);
    expect(Q.aqi('o3_1', 0.125).index).toBe(101);
    expect(Q.aqi('so2', 304).index).toBe(200);
    expect(Q.aqi('pm25', 325.4).index).toBe(500);
    expect(Q.aqi('pm25', 12.0).index).toBe(Math.round((49 / 26.3) * 2.9 + 51));
    expect(() => Q.aqi('pm25', 400)).toThrow();
    expect(() => Q.aqi('o3_8', 0.25)).toThrow();
  });
  it('plume', () => {
    near(Q.plume(100, 5, 50, 30, 50) * 1e6, 1058.28, 1e-1);
    const s = Q.sigmas('D', 1000);
    near(s.sy, 76.277, 1e-3);
    near(s.sz, 37.9473, 1e-4);
    near(Q.sigmas('F', 1000, true).sz, 80 / Math.sqrt(2.5), 1e-9);
    near(Q.sigmas('E', 2000).sz, 60 / 1.6, 1e-9);
    near(Q.ppmToUg(1, Q.MOLAR_MASS.so2, Q.molarVolume(298.15, 101325)), 2620.29, 1e-2);
    near(Q.molarVolume(273.15, 101325), 22.4, 0.01);
    near(Q.rainRate(40, 200, 1.6).rate, 11.5307, 1e-4);
    near(Q.rainRate(50, 200, 1.6).rate, 500 ** 0.625, 1e-9);
    expect(Q.stabilityClass(1, 'strong')).toBe('A');
    expect(Q.stabilityClass(4, 'slight')).toBe('C');
    expect(Q.stabilityClass(2.5, 'nightClear')).toBe('F');
    expect(Q.stabilityClass(7, 'nightCloudy')).toBe('D');
    // Briggs rise: F = 100 -> xf = 119 * 100^0.4
    const pr = Q.plumeRise(100, 5, 1e5);
    near(pr.finalDistance, 119 * 100 ** 0.4, 1e-9);
    near(pr.final, (1.6 * 100 ** (1 / 3) * pr.finalDistance ** (2 / 3)) / 5, 1e-9);
    // box: steady = (E/V + (u/L) Cin)/(u/L + k)
    const b = Q.box(10, 1000, 1000, 100, 2, 1e-6, 1e-5, 0);
    near(b.steady, (10 / 1e8 + 2e-3 * 1e-6) / (2e-3 + 1e-5), 1e-15);
    // ground max for H = 0 should be at the smallest x; for elevated, c max where sz ~ H/sqrt2
    const gm = Q.groundMaximum(100, 5, 50, 'D', false);
    const sz = Q.sigmas('D', gm.x).sz;
    // Exact only when sigma y / sigma z is constant; Briggs sigmas vary slowly, so a loose band.
    const ratio = sz / (50 / Math.SQRT2);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });
  it('METAR / TAF', () => {
    const m = decodeMetar('METAR KORD 231751Z 25012G20KT 10SM FEW020 SCT250 22/14 A2992 RMK AO2 SLP132 T02220139');
    expect(m.wind).toMatchObject({ direction: 250, speed: 12, gust: 20, unit: 'KT' });
    expect(m.visibility?.value).toBe(10);
    expect(m.clouds.map((c) => [c.cover, c.base])).toEqual([
      ['FEW', 2000],
      ['SCT', 25000],
    ]);
    expect([m.temperature, m.dewPoint]).toEqual([22, 14]);
    expect(m.altimeter).toEqual({ value: 29.92, unit: 'inHg' });
    near(m.remarks.seaLevel!, 1013.2, 1e-9);
    near(m.remarks.precise!.temperature, 22.2, 1e-9);
    near(m.remarks.precise!.dewPoint!, 13.9, 1e-9);
    const m2 = decodeMetar('METAR EGLL 121350Z 09008KT 060V120 4000 -RA BR BKN008 OVC015 12/11 Q1008');
    expect(m2.wind).toMatchObject({ direction: 90, speed: 8, from: 60, to: 120 });
    expect(m2.visibility).toMatchObject({ value: 4000, meters: true });
    expect(m2.weather.map((w) => w.intensity)).toEqual(['light', 'moderate']);
    expect(m2.altimeter).toEqual({ value: 1008, unit: 'hPa' });
    const m3 = decodeMetar(
      'METAR KJFK 010051Z VRB03KT 1/2SM R04R/P6000FT FG VV002 M02/M03 A3012 RMK AO2 SLP201 T10221028 P0005',
    );
    expect(m3.wind).toMatchObject({ direction: null, speed: 3 });
    expect(m3.visibility?.value).toBe(0.5);
    expect(m3.clouds).toMatchObject([{ cover: 'VV', base: 200 }]);
    expect([m3.temperature, m3.dewPoint]).toEqual([-2, -3]);
    near(m3.remarks.precise!.temperature, -2.2, 1e-9);
    near(m3.remarks.precise!.dewPoint!, -2.8, 1e-9);
    near(m3.remarks.seaLevel!, 1020.1, 1e-9);
    near(m3.remarks.hourlyPrecip!, 0.05, 1e-9);
    expect(m3.runway).toEqual(['R04R/P6000FT']);
    const t = decodeTaf(
      'TAF KORD 231720Z 2318/2424 25012G20KT P6SM SCT250 FM240200 20006KT P6SM BKN100 ' +
        'TEMPO 2408/2412 4SM -SHRA OVC040 PROB30 2412/2416 2SM TSRA BKN020CB',
    );
    expect(t.periods.map((p) => p.change)).toEqual(['BASE', 'FM', 'TEMPO', 'PROB']);
    expect(t.periods[3]!.probability).toBe(30);
    expect(t.periods[3]!.clouds[0]).toMatchObject({ cover: 'BKN', base: 2000, type: 'CB' });
    expect(t.unknown).toEqual([]);
  });
});

describe('geophysics', () => {
  it('cases', () => {
    near(GR.normalGravity(45), 9.806197769, 1e-9);
    near(GR.normalGravity(0), 9.7803253359, 1e-10);
    near(GR.normalGravity(90), 9.8321849378, 1e-9);
    near(GR.bouguerSlab(2670, 100) / 1e-5, 11.1969, 1e-3);
    near(
      GR.bodyAnomaly({ body: 'sphere', contrast: 500, radius: 100, depth: 200, bottom: 0, thickness: 0 }, 0) / 1e-5,
      0.349466,
      1e-6,
    );
    // fault: far left 0, far right full slab
    const fault = { body: 'fault' as const, contrast: 300, radius: 0, depth: 100, bottom: 0, thickness: 50 };
    near(GR.bodyAnomaly(fault, 1e9), 2 * Math.PI * GR.G * 300 * 50, 1e-12);
    near(GR.bodyAnomaly(fault, 0), Math.PI * GR.G * 300 * 50, 1e-15);
    // vertical cylinder: very long -> 2πGρ(√(z²+r²) − z) ... on axis from top z: full = 2πGρ(L + √(z²+r²) − √(b²+r²))
    const vc = GR.bodyAnomaly(
      { body: 'vcylinder', contrast: 500, radius: 100, depth: 50, bottom: 1e7, thickness: 0 },
      0,
    );
    near(vc, 2 * Math.PI * GR.G * 500 * (Math.hypot(50, 100) - 50), 1e-9);
    near(
      GR.halfWidth({ body: 'sphere', contrast: 1, radius: 1, depth: 200, bottom: 0, thickness: 0 })!,
      200 * 0.7664,
      1e-2,
    );
    near(SP.inclination(30), 49.1066, 1e-4);
    near(SP.latitudeFromInclination(49.1066), 30, 1e-4);
    near(
      SP.inducedSphere({ field: 50000e-9, inc: 90, chi: 0.01, radius: 10, depth: 20 }, 0) * 1e9,
      (2 / 3) * 0.01 * 50000 * (1 / 8),
      1e-9,
    );
    // induced sphere, horizontal field (inc 0) at x = 0: cos = 0 -> -μ0 m/(4π r³)
    near(
      SP.inducedSphere({ field: 50000e-9, inc: 0, chi: 0.01, radius: 10, depth: 20 }, 0) * 1e9,
      -(1 / 3) * 0.01 * 50000 * (1 / 8),
      1e-9,
    );
    const vgp = SP.virtualPole({ latitude: 45, longitude: 0 }, 0, SP.inclination(45));
    near(vgp.latitude, 90, 1e-6);
    // Butler (1992) example: site 40N 90E? use: site lat 60, lon 30, D 30, I 60 -> p = atan(2/tan60) = 49.1066
    const v2 = SP.virtualPole({ latitude: 60, longitude: 30 }, 30, 60);
    const p = Math.atan2(2, Math.tan(Math.PI / 3));
    const sinlp = Math.sin(Math.PI / 3) * Math.cos(p) + Math.cos(Math.PI / 3) * Math.sin(p) * Math.cos(Math.PI / 6);
    near(v2.latitude, (Math.asin(sinlp) * 180) / Math.PI, 1e-9);
    const ev = SP.eulerVelocity({ latitude: 90, longitude: 0 }, 1, { latitude: 0, longitude: 0 });
    near(ev.speed * 100 * 365.25 * 86400, 11.1195, 1e-3);
    near(ev.azimuth, 90, 1e-9);
    const ev2 = SP.eulerVelocity({ latitude: 0, longitude: 0 }, 1, { latitude: 60, longitude: 90 });
    near(ev2.speed * 100 * 365.25 * 86400, 11.1195, 1e-3);
    near(LY.airyRoot(3000, 2800, 3300), 16800, 1e-9);
    near(LY.airyAntiroot(4000, 2800, 3300, 1000), (4000 * 1800) / 500, 1e-9);
    near(LY.prattDensity(1000, 3000, 100e3), (3000 * 100e3) / 101e3, 1e-9);
    near(LY.geotherm({ surface: 10, heatFlow: 0.065, conductivity: 2.5, production: 1e-6 }, 10e3), 250, 1e-9);
    const hs = LY.halfSpace(
      {
        mantle: 1300,
        surface: 0,
        diffusivity: 1e-6,
        conductivity: 3.3,
        expansion: 3e-5,
        mantleDensity: 3300,
        waterDensity: 1000,
        ridgeDepth: 2500,
      },
      50e6 * 365.25 * 86400,
    );
    const kt = 1e-6 * 50e6 * 365.25 * 86400;
    near(hs.depth, 2500 + ((2 * 3300 * 3e-5 * 1300) / 2300) * Math.sqrt(kt / Math.PI), 1e-6);
    near(hs.heatFlow, (3.3 * 1300) / Math.sqrt(Math.PI * kt), 1e-12);
    near(LY.geometricFactor('wenner', 10, 0, 0) * 1.5, 94.2478, 1e-4);
    near(LY.geometricFactor('schlumberger', 10, 1, 0), (Math.PI * 99) / 2, 1e-9);
    near(LY.geometricFactor('dipole', 10, 0, 2), Math.PI * 2 * 3 * 4 * 10, 1e-9);
    near(LY.twoLayerWenner(100, 100, 5, 10).rho, 100, 1e-9);
    near(LY.twoLayerWenner(100, 1000, 1, 1e5).rho, 1000, 2);
    near(LY.twoLayerWenner(100, 1000, 100, 0.01).rho, 100, 1e-6);
    // series by hand, k = 1/3, h=5, a=10
    let sum = 0;
    for (let n = 1; n < 1000; n++) {
      const u = n;
      sum += (1 / 3) ** n * (1 / Math.sqrt(1 + u * u) - 1 / Math.sqrt(4 + u * u));
    }
    near(LY.twoLayerWenner(100, 200, 5, 10).rho, 100 * (1 + 4 * sum), 1e-9);
  });
});

describe('stereonet', () => {
  it('cases', () => {
    const p = GEO.pole({ strike: 30, dip: 40 });
    near(p.trend, 300, 1e-9);
    near(p.plunge, 50, 1e-9);
    const i = GEO.intersection(GEO.fromDipDirection(90, 30), GEO.fromDipDirection(180, 60));
    near(i.trend, 108.435, 1e-3);
    near(i.plunge, 28.7106, 1e-4);
    near(GEO.angle(GEO.pole(GEO.fromDipDirection(90, 30)), GEO.pole(GEO.fromDipDirection(180, 60))), 64.3411, 1e-4);
    near(GEO.apparentDip(GEO.fromDipDirection(90, 40), 60), 36.0052, 1e-4);
    near(GEO.apparentDip(GEO.fromDipDirection(90, 40), 0), 0, 1e-9);
    near(GEO.apparentDip(GEO.fromDipDirection(90, 40), 90), 40, 1e-9);
    const tp = GEO.threePoint({ x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 90 }, { x: 0, y: 100, z: 95 });
    near(tp.dip, 6.37937, 1e-4);
    near(tp.direction, 63.4349, 1e-4);
    const f = ST.fisher([
      { trend: 10, plunge: 20 },
      { trend: 20, plunge: 25 },
      { trend: 15, plunge: 30 },
    ]);
    near(f.mean.trend, 14.9384, 1e-4);
    near(f.mean.plunge, 25.057, 1e-3);
    near(f.r, 2.986026, 1e-5);
    near(f.kappa, 143.121, 1e-2);
    near(f.alpha95, 10.3429, 1e-3);
    // rake
    const r = GEO.rakeLine({ strike: 90, dip: 30 }, 90);
    near(r.trend, 180, 1e-9);
    near(r.plunge, 30, 1e-9);
    const r2 = GEO.rakeLine({ strike: 90, dip: 30 }, 45);
    // pitch 45 in a plane dipping 30: plunge = asin(sin45 sin30) = 20.705; trend = 90 + atan(tan45 cos30)=90+40.89
    near(r2.plunge, (Math.asin(Math.sin(Math.PI / 4) * 0.5) * 180) / Math.PI, 1e-9);
    near(r2.trend, 90 + (Math.atan(Math.cos(Math.PI / 6)) * 180) / Math.PI, 1e-9);
    // untilt: bedding strike 0 dip 30 E; its own pole goes vertical
    const u = GEO.untilt(GEO.pole({ strike: 0, dip: 30 }), { strike: 0, dip: 30 });
    near(u.plunge, 90, 1e-9);
    // a horizontal line along strike is unchanged
    const u2 = GEO.untilt({ trend: 0, plunge: 0 }, { strike: 0, dip: 30 });
    near(u2.plunge, 0, 1e-9);
    near(u2.trend % 180, 0, 1e-9);
    // true thickness
    near(GEO.trueThickness(100, 30, 0), 50, 1e-9);
    near(GEO.trueThickness(100, 30, 30), 0, 1e-9);
    near(GEO.trueThickness(100, 30, -30), 100 * Math.sin(Math.PI / 3), 1e-9);
    // orientation tensor: girdle of poles about a fold axis 000/00: planes with dips 30 E, vertical, 30 W
    const planes = [
      GEO.fromDipDirection(90, 30),
      GEO.fromDipDirection(90, 90),
      GEO.fromDipDirection(270, 30),
      GEO.fromDipDirection(90, 60),
    ];
    const t = ST.orientationTensor(planes.map(GEO.pole));
    near(t.axes[2].plunge, 0, 1e-6);
    near(t.axes[2].trend % 180, 0, 1e-6);
    expect(t.shape).toBeLessThan(1);
    expect(ST.roseBins([5, 185, 95], 10, true)).toEqual(
      Object.assign(new Array(36).fill(0), { 0: 2, 18: 2, 9: 1, 27: 1 }),
    );
    near(
      ST.density(
        [
          [0, 0, -1],
          [0, 0, 1],
          [1, 0, 0],
        ],
        [0, 0, -1],
      ),
      200 / 3,
      1e-9,
    );
  });
});

describe('dating', () => {
  it('cases', () => {
    near(D.ratioAge(0.01, 1.42e-11) / 1e6, 700.728, 1e-3);
    const rc = D.radiocarbon(0.5, null);
    near(rc.age, 5568.05, 1e-2);
    near(D.normalization(-20), 0.989822, 1e-6);
    near(D.ratioAge(0.1, D.SYSTEMS.u238.lambda) / 1e6, 614.409, 1e-3);
    near(D.concordia(D.ratioAge(0.1, D.SYSTEMS.u238.lambda))[0], 0.831436, 1e-6);
    near(D.kArAge(0.01) / 1e6, 164.394, 1e-3);
    near(ISO.fractionation(0, 1.01, 0.5).rayleigh, -6.9075, 1e-4);
    near(
      ISO.mix([
        { fraction: 0.5, concentration: 10, delta: -5 },
        { fraction: 0.5, concentration: 1, delta: 5 },
      ]).delta,
      -4.09091,
      1e-5,
    );
    const ol = ISO.formula({ SiO2: 40, MgO: 50, FeO: 10 }, 4, null);
    near(ol.cations.Si!, 0.98219, 1e-4);
    near(ol.cations.Mg!, 1.8303, 1e-4);
    near(ol.cations.Fe!, 0.20535, 1e-4);
    // Δ14C: F 1, year 1950 -> 0; F 1.1 measured 2000: (1.1 e^{-50/8267} - 1)·1000
    near(D.radiocarbon(1.1, null, 2000).big!, (1.1 * Math.exp(-50 / 8267) - 1) * 1000, 1e-9);
    // Ar-Ar round trip
    const j = D.jFactor(28.201e6, 100);
    near(D.arArAge(100, j) / 1e6, 28.201, 1e-9);
    // concordia intercepts of a chord through 1 Ga and 3 Ga points
    const [x1, y1] = D.concordia(1e9);
    const [x3, y3] = D.concordia(3e9);
    const b = (y3 - y1) / (x3 - x1);
    const ints = D.concordiaIntercepts(y1 - b * x1, b);
    near(ints[0], 1e9, 1);
    near(ints[1], 3e9, 1);
    // batch fractionation: f = 1 -> delta0
    near(ISO.fractionation(10, 1.02, 1).batch, 10, 1e-9);
    // Droop: a spinel-like test — with ideal cations 3 on 4 O and all Fe as FeO giving total > 3
    const sp = ISO.formula({ FeO: 100 }, 4, 3);
    // magnetite Fe3O4: 4 O, 3 cations: Fe3+ = 2, Fe2+ = 1
    near(sp.cations.Fe3!, 2, 1e-9);
    near(sp.cations.Fe!, 1, 1e-9);
    // York: Pearson (1901) data with York (1966) weights; York 2004 gives b = -0.4805, a = 5.4799
    const x = [0, 0.9, 1.8, 2.6, 3.3, 4.4, 5.2, 6.1, 6.5, 7.4];
    const y = [5.9, 5.4, 4.4, 4.6, 3.5, 3.7, 2.8, 2.8, 2.4, 1.5];
    const wx = [1000, 1000, 500, 800, 200, 80, 60, 20, 1.8, 1];
    const wy = [1, 1.8, 4, 8, 20, 20, 70, 70, 100, 500];
    const fit = york(x.map((xi, i) => ({ x: xi, y: y[i], sx: 1 / Math.sqrt(wx[i]), sy: 1 / Math.sqrt(wy[i]) })));
    near(fit.slope, -0.480533, 1e-5);
    near(fit.intercept, 5.47991, 1e-5);
    near(fit.seSlope, 0.057985, 1e-5);
    near(fit.seIntercept, 0.294971, 1e-5);
    // calibration: flat curve with no error -> gaussian; median = age
    const curve = Array.from({ length: 2001 }, (_, i) => ({ cal: 1000 + i, c14: 1000 + i, sigma: 1e-6 }));
    const cal = D.calibrate(2000, 30, curve);
    expect(cal.median).toBe(2000);
    near(cal.ranges68[0][0] - cal.ranges68[0][1], 60, 2);
    near(cal.ranges95[0][0] - cal.ranges95[0][1], 120, 3);
    const pl = D.plateau([
      { gas: 10, age: 90, sigma: 1 },
      { gas: 30, age: 100, sigma: 1 },
      { gas: 30, age: 101, sigma: 1 },
      { gas: 30, age: 100.5, sigma: 1 },
    ]);
    expect(pl?.from).toBe(2);
    expect(pl?.to).toBe(4);
    near(pl!.gas, 90, 1e-9);
  });
});

describe('moist', () => {
  it('cases', () => {
    near(TH.esWater(293.15) / 100, 23.3695, 1e-4);
    const e = 0.5 * TH.esWater(293.15);
    near(TH.mixingRatio(e, 1e5) * 1000, 7.35383, 1e-5);
    near(TH.dewPoint(e) - 273.15, 9.27009, 1e-5);
    near(TH.potentialTemperature(280, 85000), 293.307, 1e-3);
    near(TH.lclTemperatureBolton(303.15, 293.15), 290.815, 1e-3);
    near(TH.thetaE(303.15, 293.15, 1e5), 347.523, 1e-3);
    near(TH.thickness(1e5, 5e4, 270), 5478.05, 1e-2);
    near(TH.capeTrapezoids([900, 800, 700, 600, 500], [0, 2, 3, 2, 0]).cape, 292.593, 1e-3);
    near(TH.saltHumidity('nacl', 25), 75.29, 1e-9);
    near(TH.saltHumidity('mgcl2', 25), 32.78, 1e-9);
    near(TH.saltHumidity('nacl', 22.5), (75.47 + 75.29) / 2, 1e-9);
    // Romps 2017 table check: p 1000 hPa, T 300 K, RH 0.5 -> LCL height ~ 1433 m? compute Espy ~ 125 (T-Td)
    const r = TH.lclRomps(1e5, 300, 0.5);
    near(r.t, TH.lclTemperatureBolton(300, TH.dewPoint(0.5 * TH.esWater(300))), 0.5);
    // wet bulb: saturated -> T
    near(TH.wetBulb(293.15, 293.15, 1e5), 293.15, 1e-6);
    const tw = TH.wetBulb(303.15, 293.15, 1e5);
    near(tw - 273.15, 22.9, 0.4);
    // moist lapse at 1000 hPa, 20 C: about 4.3-4.5 K/km
    const ml = TH.moistLapse(293.15, 1e5) * 1000;
    expect(ml).toBeGreaterThan(4.2);
    expect(ml).toBeLessThan(4.6);
    // moist adiabat from 1000 hPa 20 C to 500 hPa: thetaE conserved roughly: compare using thetaE at the end (saturated)
    const t500 = TH.moistAdiabat(293.15, 1e5, 5e4);
    const te0 = TH.thetaE(293.15, 293.15, 1e5);
    const te1 = TH.thetaE(t500, t500, 5e4);
    near(te0, te1, 1.5);
    near(TH.virtualTemperature(300, 0.01), (300 * (1 + 0.01 / 0.622)) / 1.01, 1e-9);
    near(TH.frostPoint(TH.esIce(263.15)), 263.15, 1e-9);
    near(TH.lambertW(1), 0.5671432904, 1e-9);
    near(TH.lambertW(-0.1, -1), -3.577152064, 1e-8);
  });
});

describe('geodiagrams', () => {
  it('cases', () => {
    expect(TER.classify(TER.USDA, [40, 40, 20])).toBe('loam');
    expect(TER.classify(TER.USDA, [70, 15, 15])).toBe('sandyLoam');
    expect(TER.classify(TER.USDA, [10, 30, 60])).toBe('clay');
    const pt = TER.project([20, 30, 50]);
    near(pt[0], 55, 1e-9);
    near(pt[1], 43.3013, 1e-4);
    const h = buildMatrix(parseRelations('1 above 2\n2 above 3\n1 above 3'));
    expect(h.edges.length).toBe(2);
    expect(h.redundant.length).toBe(1);
    expect(() => buildMatrix(parseRelations('4 above 5\n5 above 4'))).toThrow();
    const eq = buildMatrix(parseRelations('1 above 2\n2 = 3\n3 above 4'));
    expect(eq.nodes.length).toBe(3);
    expect(eq.edges.length).toBe(2);
  });
});
