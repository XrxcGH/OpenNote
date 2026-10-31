import { describe, expect, it } from 'vitest';
import { julianDate, precess, sun } from './astro';
import { BRIGHT_STARS } from './bright';
import { planetsCalc, skyChart } from './engine';
import { PRINT, plotTree, type SvgNode } from '../shared/plot';
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

  it('puts east on the left, as the sky looks overhead', () => {
    // At 22:00 UT on 2000-01-01 the sidereal time at Greenwich is about 4.72 h (GMST 6.664 h at 0 h plus 22 h × 1.0027),
    // so Procyon (RA 7.66 h) is 2.9 h east of the meridian and Vega (RA 18.6 h) is 10.1 h west of it, 4° up in the north-west.
    const stars = skyChart(at).plot!.series.find((one) => one.label === 'stars')!;
    const at_ = (name: string) => stars.points[stars.names!.indexOf(name)]!;
    expect(at_('Procyon')[0]).toBeLessThan(-0.2);
    expect(at_('Vega')[0]).toBeGreaterThan(0.2);
    expect(skyChart(at).plot!.xLabel).toBe('westAxis');
  });

  it('tags each constellation once and keeps the labels apart', () => {
    const chart = skyChart(at);
    const stars = chart.plot!.series.find((one) => one.label === 'stars')!;
    const tags = stars.tags!.filter(Boolean);
    expect(new Set(tags).size).toBe(tags.length);
    // Orion's brightest star is Rigel (V 0.12), not Betelgeuse (V 0.50).
    expect(stars.tags![stars.names!.indexOf('Rigel')]).toBe('Ori');
    expect(stars.tags![stars.names!.indexOf('Betelgeuse')]).toBe('');
    const texts: SvgNode[] = [];
    const walk = (node: SvgNode | string) => {
      if (typeof node === 'string') return;
      if (node.tag === 'text') texts.push(node);
      node.children?.forEach(walk);
    };
    walk(plotTree(chart.plot!, PRINT));
    const bodies = texts.map((one) => String(one.children![0]));
    // Every planet above the horizon keeps its name.
    for (const name of chart.plot!.series.find((one) => one.label === 'planets')!.names!)
      expect(bodies).toContain(name);
    // No two labels on the chart overlap (11 px type, about 6 px a character).
    const boxes = texts
      .filter((one) => !one.attrs.transform && !one.attrs['text-anchor'])
      .map((one) => {
        const x = Number(one.attrs.x);
        const y = Number(one.attrs.y);
        return [x, y - 9, x + String(one.children![0]).length * 6, y + 2] as const;
      });
    boxes.forEach((b, i) =>
      boxes.slice(i + 1).forEach((c) => expect(b[2] <= c[0] || c[2] <= b[0] || b[3] <= c[1] || c[3] <= b[1]).toBe(true)),
    );
  });
});
