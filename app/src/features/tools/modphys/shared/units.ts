// The units a field can be typed in, by dimension. Each unit is a factor to SI (and an offset for temperatures in
// degrees), so engines always work in SI. The first unit of a list is the tool's usual one, not SI.
import { ASTRO, C } from './constants';

export type Dimension =
  | 'length'
  | 'energy'
  | 'mass'
  | 'time'
  | 'frequency'
  | 'field'
  | 'numberDensity'
  | 'temperature'
  | 'speed'
  | 'distance'
  | 'angle'
  | 'wavenumber'
  | 'power'
  | 'current'
  | 'voltage'
  | 'capacitance';

interface Unit {
  id: string;
  factor: number;
  offset?: number;
}

const u = (id: string, factor: number, offset?: number): Unit =>
  offset === undefined ? { id, factor } : { id, factor, offset };

export const UNITS: Record<Dimension, readonly Unit[]> = {
  length: [
    u('nm', 1e-9),
    u('pm', 1e-12),
    u('Å', 1e-10),
    u('µm', 1e-6),
    u('mm', 1e-3),
    u('cm', 1e-2),
    u('m', 1),
    u('a₀', C.a0),
  ],
  energy: [
    u('eV', C.e),
    u('meV', 1e-3 * C.e),
    u('keV', 1e3 * C.e),
    u('MeV', 1e6 * C.e),
    u('J', 1),
    u('cm⁻¹', C.h * C.c * 100),
  ],
  mass: [u('mₑ', C.me), u('u', C.u), u('mₚ', C.mp), u('kg', 1), u('g', 1e-3)],
  time: [
    u('s', 1),
    u('fs', 1e-15),
    u('ps', 1e-12),
    u('ns', 1e-9),
    u('µs', 1e-6),
    u('ms', 1e-3),
    u('min', 60),
    u('h', 3600),
    u('d', 86400),
    u('yr', ASTRO.year),
  ],
  frequency: [u('Hz', 1), u('kHz', 1e3), u('MHz', 1e6), u('GHz', 1e9), u('THz', 1e12)],
  field: [u('T', 1), u('mT', 1e-3), u('µT', 1e-6), u('nT', 1e-9), u('G', 1e-4)],
  numberDensity: [u('m⁻³', 1), u('cm⁻³', 1e6)],
  temperature: [u('K', 1), u('°C', 1, 273.15), u('eV', C.e / C.kB)],
  speed: [u('m/s', 1), u('km/s', 1e3), u('c', C.c)],
  distance: [
    u('pc', ASTRO.pc),
    u('kpc', 1e3 * ASTRO.pc),
    u('Mpc', 1e6 * ASTRO.pc),
    u('ly', ASTRO.ly),
    u('au', ASTRO.au),
    u('km', 1e3),
    u('m', 1),
    u('R☉', ASTRO.rSun),
    u('R⊕', ASTRO.rEarth),
    u('R♃', ASTRO.rJupiter),
  ],
  angle: [u('°', Math.PI / 180), u('rad', 1), u('arcmin', Math.PI / 10800), u('arcsec', Math.PI / 648000)],
  wavenumber: [u('cm⁻¹', 100), u('m⁻¹', 1)],
  power: [u('W', 1), u('L☉', ASTRO.lSun)],
  current: [u('A', 1), u('mA', 1e-3), u('µA', 1e-6)],
  voltage: [u('V', 1), u('mV', 1e-3)],
  capacitance: [u('F', 1), u('µF', 1e-6), u('nF', 1e-9), u('pF', 1e-12)],
};

/** The unit ids a dimension offers. */
export const unitIds = (dimension: Dimension): readonly string[] => UNITS[dimension].map((one) => one.id);

function find(dimension: Dimension, id: string): Unit {
  const unit = UNITS[dimension].find((one) => one.id === id);
  if (!unit) throw new Error(`No unit "${id}" for ${dimension}`);
  return unit;
}

/** A value in a unit, in SI. */
export function toSI(value: number, dimension: Dimension, id: string): number {
  const unit = find(dimension, id);
  return (value + (unit.offset ?? 0)) * unit.factor;
}

/** An SI value, in a unit. */
export function fromSI(value: number, dimension: Dimension, id: string): number {
  const unit = find(dimension, id);
  return value / unit.factor - (unit.offset ?? 0);
}
