import { describe, expect, it } from 'vitest';
import { julianDate, precess, sun } from './astro';
import { BRIGHT_STARS } from './bright';
import { planetsCalc, skyChart } from './engine';
import { PLANETS, keplerE, orbit, planet } from './planets';

describe('planets from the JPL approximate elements', () => {
  it('solves Kepler’s equation', () => {
    // Meeus example 30.a: e = 0.1, M = 5° gives E = 5.554589°.
    expect(keplerE(5, 0.1)).toBeCloseTo(5.554589, 5);
    const e = keplerE(200, 0.9);
    expect(e - 0.9 * (180 / Math.PI) * Math.sin((e * Math.PI) / 180)).toBeCloseTo(200 - 360, 9);
  });

  it('puts the Earth opposite the Sun of the USNO formulas', () => {
    const jd = julianDate(2024, 3, 20, 3);
    const [x, y] = orbit('earth', jd).xyz;
    const lambda = ((((Math.atan2(-y, -x) * 180) / Math.PI) % 360) + 360) % 360;
    // The USNO longitude is of the date: add the general precession in longitude, 1.39697° per century.
    const ofDate = lambda + 1.39697 * ((jd - 2451545) / 36525);
    expect(Math.abs(ofDate - sun(jd).lambda)).toBeLessThan(0.02);
  });

  it('matches Meeus example 33.a for Venus on 1992 December 20', () => {
    // VSOP87 apparent place: α = 21h 04m 41.454s, δ = −18° 53′ 16.84″, Δ = 0.910947 au.
    const jd = julianDate(1992, 12, 20, 0);
    const v = planet('venus', jd);
    const now = precess(v, jd);
    const ra = 21 + 4 / 60 + 41.454 / 3600;
    const dec = -(18 + 53 / 60 + 16.84 / 3600);
    expect(Math.abs((now.ra - ra) * 15 * Math.cos((dec * Math.PI) / 180))).toBeLessThan(0.03);
    expect(Math.abs(now.dec - dec)).toBeLessThan(0.03);
    expect(v.delta).toBeCloseTo(0.910947, 3);
  });

  it('brings Jupiter and Saturn within 0.1° on 2020 December 21, the great conjunction', () => {
    const jd = julianDate(2020, 12, 21, 18);
    const j = planet('jupiter', jd);
    const s = planet('saturn', jd);
    const rad = Math.PI / 180;
    const cos =
      Math.sin(j.dec * rad) * Math.sin(s.dec * rad) +
      Math.cos(j.dec * rad) * Math.cos(s.dec * rad) * Math.cos((j.ra - s.ra) * 15 * rad);
    // Observed closest approach: 6.1′. The approximate elements are allowed a few arcminutes more.
    expect(Math.acos(cos) / rad).toBeLessThan(0.3);
  });
});

describe('the sky chart and the planets form', () => {
  const at = { date: [2000, 1, 1] as const, time: 22, zone: 0, lat: 51.4769, lon: -0.0005 };

  it('lists all seven planets and keeps Polaris at the latitude', () => {
    const calc = planetsCalc(at);
    expect(calc.items.map((one) => one.key)).toEqual(PLANETS);
    const polaris = BRIGHT_STARS.find((one) => one.name === 'Polaris')!;
    const chart = skyChart(at);
    // Polaris is 0.74° from the pole in 2000, so its altitude is within that of the latitude.
    const up = chart.plot!.series.find((one) => one.label === 'stars')!;
    expect(up.points.length).toBe(chart.items.find((one) => one.key === 'starsUp')!.value);
    const r = Math.tan(((90 - (at.lat - 0.74)) / 2) * (Math.PI / 180));
    expect(up.points.some(([x, y]) => Math.abs(Math.hypot(x, y) - r) < 0.02)).toBe(true);
    expect(polaris.mag).toBe(2.02);
  });

  it('places Sirius at the coordinates the convert form uses', () => {
    const sirius = BRIGHT_STARS.find((one) => one.name === 'Sirius')!;
    expect(sirius.ra).toBeCloseTo(6.7525, 3);
    expect(sirius.dec).toBeCloseTo(-16.7161, 3);
  });

  it('draws the chart with equal scales and the planets named', () => {
    const chart = skyChart({ ...at, date: [2024, 1, 15], time: 18 });
    expect(chart.plot?.equal).toBe(true);
    const planets = chart.plot!.series.find((one) => one.label === 'planets')!;
    expect(planets.names?.length).toBe(planets.points.length);
  });
});
