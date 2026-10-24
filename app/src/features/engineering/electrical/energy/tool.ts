// The energy tool: wind, wind statistics, sun position, photovoltaics, emissions, cost of energy, and energy units.
import type { Field, ToolSpec } from '../spec';
import { fail, eng, fmt, need, nonNegative, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import {
  BETZ,
  ENERGY_UNITS,
  FUELS,
  capacityFactor,
  co2PerFuelKwh,
  co2PerOutputKwh,
  convertEnergy,
  cosIncidence,
  declination,
  exceedance,
  lcoe,
  meanCube,
  pvOutput,
  sunPosition,
  sunriseHourAngle,
  turbinePower,
  weibullFromMean,
  windPowerDensity,
} from './engine';
import { toDegrees } from '../shared';

const MODES = ['wind', 'windStats', 'solar', 'pv', 'emissions', 'lcoe', 'convert'] as const;
const modeOf = (v: Values): string => v.mode ?? 'wind';
const only =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(modeOf(v));

const choice = (id: string, label: Field['label'], initial: string, values: readonly string[], when?: Field['when']) =>
  ({
    id,
    label,
    initial,
    kind: 'select',
    options: values.map((value) => ({ value, label: value as Field['label'] })),
    when,
  }) satisfies Field;

const FIELDS: readonly Field[] = [
  choice('mode', 'energyMode', 'wind', MODES),
  { id: 'speed', label: 'windSpeed', initial: '8', unit: 'm/s', when: only('wind') },
  { id: 'rho', label: 'airDensity', initial: '1.225', unit: 'kg/m³', when: only('wind', 'windStats') },
  { id: 'dia', label: 'rotorDiameter', initial: '80', unit: 'm', when: only('wind', 'windStats') },
  { id: 'cp', label: 'powerCoefficient', initial: '0.45', when: only('wind', 'windStats') },
  { id: 'mean', label: 'meanSpeed', initial: '7', unit: 'm/s', when: only('windStats') },
  { id: 'shape', label: 'weibullShape', initial: '2', when: only('windStats'), hint: 'shapeHint' },
  { id: 'above', label: 'speedAbove', initial: '12', unit: 'm/s', when: only('windStats') },
  { id: 'cutin', label: 'cutIn', initial: '3', unit: 'm/s', when: only('windStats') },
  { id: 'rated', label: 'ratedSpeed', initial: '12', unit: 'm/s', when: only('windStats') },
  { id: 'cutout', label: 'cutOut', initial: '25', unit: 'm/s', when: only('windStats') },
  { id: 'lat', label: 'latitude', initial: '34', when: only('solar'), hint: 'latitudeHint' },
  { id: 'day', label: 'dayOfYear', initial: '172', when: only('solar') },
  { id: 'hour', label: 'solarHour', initial: '12', when: only('solar'), hint: 'solarHourHint' },
  { id: 'tilt', label: 'tilt', initial: '34', when: only('solar') },
  { id: 'azi', label: 'surfaceAzimuth', initial: '0', when: only('solar'), hint: 'azimuthHint' },
  { id: 'g', label: 'irradiance', initial: '1000', unit: 'W/m²', when: only('pv') },
  { id: 'area', label: 'arrayArea', initial: '20', unit: 'm²', when: only('pv') },
  { id: 'eff', label: 'moduleEfficiency', initial: '0.2', when: only('pv') },
  { id: 'tamb', label: 'ambientTemp', initial: '25', when: only('pv') },
  { id: 'noct', label: 'noct', initial: '45', when: only('pv') },
  { id: 'beta', label: 'tempCoefficient', initial: '0.004', when: only('pv'), hint: 'betaHint' },
  {
    ...choice('fuel', 'fuel', 'methane', Object.keys(FUELS), only('emissions')),
  },
  { id: 'plantEff', label: 'plantEfficiency', initial: '0.5', when: only('emissions') },
  { id: 'capital', label: 'capitalCost', initial: '1000', when: only('lcoe') },
  { id: 'rate', label: 'discountRate', initial: '0.07', when: only('lcoe'), hint: 'rateHint' },
  { id: 'life', label: 'lifetime', initial: '20', when: only('lcoe') },
  { id: 'cf', label: 'capacityFactor', initial: '0.35', when: only('lcoe') },
  { id: 'fom', label: 'fixedOm', initial: '0', when: only('lcoe') },
  { id: 'vom', label: 'variableCost', initial: '0', when: only('lcoe') },
  { id: 'ev', label: 'energyValue', initial: '1', when: only('convert') },
  choice('eunit', 'energyUnit', 'kWh', Object.keys(ENERGY_UNITS), only('convert')),
];

const hours = (h: number): string => {
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  return minutes === 60 ? `${whole + 1}:00` : `${whole}:${String(minutes).padStart(2, '0')}`;
};

function wind(values: Values): KitOk {
  const v = positive(values, 'speed', 'windSpeed', 'm/s');
  const rho = positive(values, 'rho', 'airDensity');
  const d = positive(values, 'dia', 'rotorDiameter', 'm');
  const cp = positive(values, 'cp', 'powerCoefficient');
  const density = windPowerDensity(v, rho);
  const power = turbinePower(d, cp, v, rho);
  const area = (Math.PI * d * d) / 4;
  const rows: KitRow[] = [
    { key: 'powerDensity', value: eng(density, 'W/m²') },
    { key: 'betzDensity', value: eng(density * BETZ, 'W/m²') },
    { key: 'sweptArea', value: eng(area, 'm²') },
    { key: 'turbinePower', value: eng(power, 'W') },
  ];
  const steps: KitStep[] = [
    { key: 'windDensity', vars: { value: eng(density, 'W/m²') }, math: '\\frac{P}{A} = \\tfrac{1}{2}\\rho v^3' },
    { key: 'betz', vars: { value: eng(density * BETZ, 'W/m²') }, math: 'C_{p,\\max} = \\frac{16}{27} \\approx 0.593' },
    {
      key: 'turbine',
      vars: { area: eng(area, 'm²'), value: eng(power, 'W') },
      math: 'P = \\tfrac{1}{2}\\rho A v^3 C_p',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `Wind ${fmt(v)} m/s: ${eng(density, 'W/m²')} in the wind, rotor of ${fmt(d)} m at Cp ${fmt(cp)} gives ${eng(power, 'W')}`,
    latex: `\\frac{P}{A} = ${fmt(density)}\\ \\mathrm{W/m^2},\\quad P = ${fmt(power)}\\ \\mathrm{W}`,
    notes: ['windNote'],
  });
}

function windStats(values: Values): KitOk {
  const mean = positive(values, 'mean', 'meanSpeed', 'm/s');
  const w = weibullFromMean(mean, positive(values, 'shape', 'weibullShape'));
  const rho = positive(values, 'rho', 'airDensity');
  const d = positive(values, 'dia', 'rotorDiameter', 'm');
  const cp = positive(values, 'cp', 'powerCoefficient');
  const above = nonNegative(values, 'above', 'speedAbove', 'm/s');
  const curve = {
    cutIn: nonNegative(values, 'cutin', 'cutIn', 'm/s'),
    rated: positive(values, 'rated', 'ratedSpeed', 'm/s'),
    cutOut: positive(values, 'cutout', 'cutOut', 'm/s'),
  };
  const cf = capacityFactor(w, curve);
  const chance = exceedance(w, above);
  const rated = turbinePower(d, cp, curve.rated, rho);
  const density = 0.5 * rho * meanCube(w);
  const rows: KitRow[] = [
    { key: 'scale', value: eng(w.c, 'm/s') },
    { key: 'probAbove', value: fmt(exceedance(w, above), 5) },
    { key: 'meanDensity', value: eng(density, 'W/m²') },
    { key: 'ratedPower', value: eng(rated, 'W') },
    { key: 'capacityFactor', value: fmt(cf, 4) },
    { key: 'annualEnergy', value: eng(rated * cf * 8760, 'Wh') },
  ];
  const steps: KitStep[] = [
    {
      key: 'weibull',
      vars: { c: eng(w.c, 'm/s') },
      math: 'c = \\frac{\\bar v}{\\Gamma(1 + 1/k)},\\quad P(v > v_0) = e^{-(v_0/c)^k}',
    },
    { key: 'meanCube', vars: { value: eng(density, 'W/m²') }, math: '\\overline{v^3} = c^3\\,\\Gamma(1 + 3/k)' },
    {
      key: 'capacity',
      vars: { cf: fmt(cf, 4), rated: eng(rated, 'W') },
      math: 'CF = \\frac{\\bar P}{P_\\mathrm{rated}}',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `Mean ${fmt(mean)} m/s (k = ${fmt(w.k)}): P(v > ${fmt(above)} m/s) = ${fmt(chance, 5)}, CF ${fmt(cf, 3)}`,
    latex: `P(v > ${fmt(above)}) = ${fmt(exceedance(w, above), 5)},\\quad CF = ${fmt(cf, 4)}`,
    notes: ['windStatsNote'],
  });
}

function solar(values: Values): KitOk {
  const lat = need(values, 'lat', 'latitude');
  if (Math.abs(lat) > 90) fail('latitudeRange');
  const day = need(values, 'day', 'dayOfYear');
  if (!Number.isInteger(day) || day < 1 || day > 366) fail('dayRange');
  const hour = need(values, 'hour', 'solarHour');
  const tilt = need(values, 'tilt', 'tilt');
  if (tilt < 0 || tilt > 180) fail('tiltRange');
  const azi = need(values, 'azi', 'surfaceAzimuth');
  const decl = declination(day);
  const hourAngle = 15 * (hour - 12);
  const sun = sunPosition(lat, decl, hourAngle);
  const noon = 90 - Math.abs(lat - decl);
  const rise = sunriseHourAngle(lat, decl);
  const cosTheta = cosIncidence(lat, decl, hourAngle, tilt, azi);
  const theta = toDegrees(Math.acos(Math.max(-1, Math.min(1, cosTheta))));
  const rows: KitRow[] = [
    { key: 'declination', value: `${fmt(decl, 5)}°` },
    { key: 'noonAltitude', value: `${fmt(noon, 5)}°` },
    { key: 'hourAngle', value: `${fmt(hourAngle, 5)}°` },
    { key: 'altitude', value: `${fmt(sun.altitude, 5)}°` },
    { key: 'azimuth', value: `${fmt(sun.azimuth, 5)}°` },
  ];
  if (typeof rise === 'number') {
    rows.push(
      { key: 'sunrise', value: hours(12 - rise / 15) },
      { key: 'sunset', value: hours(12 + rise / 15) },
      { key: 'dayLength', value: `${fmt((2 * rise) / 15, 4)} h` },
    );
  } else rows.push({ key: 'dayLength', value: '', word: rise === 'up' ? 'polarDay' : 'polarNight' });
  rows.push({
    key: 'incidence',
    value: sun.altitude > 0 && cosTheta > 0 ? `${fmt(theta, 5)}°` : '',
    word: sun.altitude > 0 && cosTheta > 0 ? undefined : 'noSun',
  });
  const steps: KitStep[] = [
    {
      key: 'cooper',
      vars: { value: fmt(decl, 5) },
      math: '\\delta = 23.45^\\circ\\sin\\!\\left(\\frac{360^\\circ(284 + n)}{365}\\right)',
    },
    {
      key: 'noonStep',
      vars: { value: fmt(noon, 5) },
      math: '\\alpha_\\mathrm{noon} = 90^\\circ - |\\varphi - \\delta|',
    },
    {
      key: 'altitudeStep',
      vars: { omega: fmt(hourAngle, 5), value: fmt(sun.altitude, 5) },
      math: '\\sin\\alpha = \\sin\\varphi\\sin\\delta + \\cos\\varphi\\cos\\delta\\cos\\omega',
    },
    {
      key: 'incidenceStep',
      vars: { value: fmt(theta, 5) },
      math: '\\cos\\theta = \\hat{n}\\cdot\\hat{s}\\ \\text{(tilted surface)}',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `Day ${day}: declination ${fmt(decl, 5)}°, noon altitude ${fmt(noon, 5)}° at latitude ${fmt(lat)}°`,
    latex: `\\delta = ${fmt(decl, 5)}^\\circ,\\quad \\alpha_\\mathrm{noon} = ${fmt(noon, 5)}^\\circ`,
    notes: ['solarNote'],
  });
}

function pv(values: Values): KitOk {
  const g = positive(values, 'g', 'irradiance', 'W/m²');
  const area = positive(values, 'area', 'arrayArea', 'm²');
  const eff = positive(values, 'eff', 'moduleEfficiency');
  const r = pvOutput(
    g,
    area,
    eff,
    need(values, 'tamb', 'ambientTemp'),
    need(values, 'noct', 'noct'),
    need(values, 'beta', 'tempCoefficient'),
  );
  const rows: KitRow[] = [
    { key: 'cellTemperature', value: `${fmt(r.cellTemperature, 4)} °C` },
    { key: 'nominalPower', value: eng(r.nominal, 'W') },
    { key: 'arrayPower', value: eng(r.power, 'W') },
  ];
  const steps: KitStep[] = [
    {
      key: 'cellTemp',
      vars: { value: fmt(r.cellTemperature, 4) },
      math: 'T_c = T_a + \\frac{\\mathrm{NOCT} - 20}{800}\\,G',
    },
    {
      key: 'pvPower',
      vars: { nominal: eng(r.nominal, 'W'), value: eng(r.power, 'W') },
      math: 'P = G A \\eta\\,[1 - \\beta (T_c - 25)]',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `Array output ${eng(r.power, 'W')} at ${fmt(g)} W/m² and a cell at ${fmt(r.cellTemperature, 4)} °C`,
    latex: `P = ${fmt(r.power)}\\ \\mathrm{W}`,
    notes: ['pvNote'],
  });
}

function emissions(values: Values): KitOk {
  const name = values.fuel ?? 'methane';
  const fuel = FUELS[name] ?? FUELS.methane!;
  const eff = positive(values, 'plantEff', 'plantEfficiency');
  const perFuel = co2PerFuelKwh(fuel);
  const perOut = co2PerOutputKwh(fuel, eff);
  const rows: KitRow[] = [
    { key: 'co2Fuel', value: `${fmt(perFuel, 5)} kg` },
    { key: 'co2Output', value: `${fmt(perOut, 5)} kg` },
  ];
  const steps: KitStep[] = [
    {
      key: 'co2Fuel',
      vars: { value: fmt(perFuel, 5) },
      math: '\\frac{m_{\\mathrm{CO_2}}}{E_\\mathrm{fuel}} = \\frac{n_C\\,M_{\\mathrm{CO_2}}}{\\mathrm{LHV}}',
    },
    {
      key: 'co2Output',
      vars: { value: fmt(perOut, 5) },
      math: '\\frac{m_{\\mathrm{CO_2}}}{E_\\mathrm{out}} = \\frac{1}{\\eta}\\,\\frac{m_{\\mathrm{CO_2}}}{E_\\mathrm{fuel}}',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `${name} at ${fmt(eff * 100)} % efficiency: ${fmt(perOut, 5)} kg CO₂ per kWh of electricity`,
    latex: `${fmt(perOut, 5)}\\ \\mathrm{kg\\,CO_2/kWh}`,
    notes: ['emissionsNote'],
  });
}

function levelized(values: Values): KitOk {
  const r = lcoe(
    nonNegative(values, 'capital', 'capitalCost'),
    need(values, 'rate', 'discountRate'),
    positive(values, 'life', 'lifetime'),
    need(values, 'cf', 'capacityFactor'),
    nonNegative(values, 'fom', 'fixedOm'),
    nonNegative(values, 'vom', 'variableCost'),
  );
  const rows: KitRow[] = [
    { key: 'crf', value: fmt(r.crf, 6) },
    { key: 'annualKwh', value: `${fmt(r.annualKwh, 6)} kWh` },
    { key: 'lcoeKwh', value: `${fmt(r.value, 5)} $/kWh` },
    { key: 'lcoeMwh', value: `${fmt(r.value * 1000, 5)} $/MWh` },
  ];
  const steps: KitStep[] = [
    { key: 'crfStep', vars: { value: fmt(r.crf, 6) }, math: '\\mathrm{CRF} = \\frac{i(1+i)^n}{(1+i)^n - 1}' },
    {
      key: 'lcoeStep',
      vars: { value: fmt(r.value, 5) },
      math: '\\mathrm{LCOE} = \\frac{C\\,\\mathrm{CRF} + F}{8760\\,\\mathrm{CF}} + v',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `LCOE ${fmt(r.value, 5)} $/kWh (capital recovery factor ${fmt(r.crf, 6)})`,
    latex: `\\mathrm{CRF} = ${fmt(r.crf, 6)},\\quad \\mathrm{LCOE} = ${fmt(r.value, 5)}\\ \\$/\\mathrm{kWh}`,
    notes: ['lcoeNote'],
  });
}

function convert(values: Values): KitOk {
  const value = need(values, 'ev', 'energyValue');
  const from = values.eunit ?? 'kWh';
  const all = convertEnergy(value, from);
  const rows: KitRow[] = Object.entries(all)
    .filter(([name]) => name !== from)
    .map(([name, amount]) => ({ key: 'unitRow' as const, value: `${fmt(amount, 6)} ${name}`, vars: { unit: name } }));
  const kwh = all.kWh ?? 0;
  const steps: KitStep[] = [
    {
      key: 'convertStep',
      vars: { amount: `${fmt(value)} ${from}`, joules: fmt(value * (ENERGY_UNITS[from] ?? 1), 6) },
    },
  ];
  return ok({
    rows,
    steps,
    answer: `${fmt(value)} ${from} = ${fmt(kwh, 6)} kWh = ${fmt(all.GJ ?? 0, 6)} GJ`,
    notes: ['convertNote'],
  });
}

const MODE: Record<string, (values: Values) => KitOk> = {
  wind,
  windStats,
  solar,
  pv,
  emissions,
  lcoe: levelized,
  convert,
};

export const spec: ToolSpec = {
  id: 'energy',
  fields: FIELDS,
  run: (values) => (MODE[modeOf(values)] ?? wind)(values),
};
