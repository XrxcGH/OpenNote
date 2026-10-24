// Rocket nozzle performance: the tool's labels, results, plots, and worked steps (kitAero.t.rocket).
export const rocket = {
  title: 'Rocket nozzle performance',
  short: 'Rocket',
  keywords:
    'rocket nozzle characteristic velocity c star thrust coefficient specific impulse isp optimum expansion ' +
    'area ratio rocket equation tsiolkovsky delta v',
  about:
    'Ideal rocket performance from the chamber state: characteristic velocity, thrust coefficient, specific ' +
    'impulse, thrust, and the rocket equation.',
  assume:
    'Ideal rocket: frozen, calorically perfect exhaust with constant γ and molar mass, steady one-dimensional ' +
    'isentropic expansion, no losses, and a nozzle that flows full. R = 8314.46 J/(kmol K) divided by the ' +
    'molar mass, and g₀ = 9.80665 m/s². Thrust against altitude uses the standard atmosphere. The rocket ' +
    'equation ignores gravity and drag.',
  f: {
    Tc: 'Chamber temperature Tc',
    molarMass: 'Exhaust molar mass',
    gamma: 'Ratio of specific heats γ',
    pc: 'Chamber pressure pc',
    mode: 'Nozzle set by',
    areaRatio: 'Area ratio ε = Ae/At',
    pe: 'Exit pressure pe',
    pa: 'Ambient pressure pa',
    throat: 'Throat area At',
    massRatio: 'Mass ratio m₀/mf (optional)',
  },
  h: {
    pa: '0 for a vacuum.',
    massRatio: 'Leave blank to skip the rocket equation.',
  },
  o: {
    areaRatio: 'Area ratio',
    exitPressure: 'Exit pressure',
    optimum: 'Optimum expansion (pe = pa)',
  },
  r: {
    cStar: 'Characteristic velocity c*',
    Me: 'Exit Mach number Me',
    eps: 'Area ratio ε',
    pe: 'Exit pressure pe',
    Te: 'Exit temperature Te',
    ue: 'Exit velocity ue',
    CFm: 'Thrust coefficient, momentum term',
    CFp: 'Thrust coefficient, pressure term',
    CF: 'Thrust coefficient CF',
    Isp: 'Specific impulse Isp',
    c: 'Effective exhaust velocity c',
    thrust: 'Thrust F',
    mdot: 'Mass flow ṁ',
    R: 'Exhaust gas constant R',
    deltaV: 'Ideal velocity change Δv',
  },
  p: {
    altitude: 'Thrust against altitude',
    H: 'Geopotential altitude H',
    F: 'Thrust F',
  },
  n: {
    separation: 'The exit pressure is far below the ambient pressure, so the flow will likely separate.',
  },
  s: {
    rkCStar:
      'Characteristic velocity from the chamber state, with R = R̄/M = {R} J/(kg K). It measures the ' +
      'combustion, not the nozzle.',
    rkExitMach:
      'Exit Mach number from the area ratio on the supersonic branch, by Brent’s method ({iterations} ' +
      'iterations).',
    rkFromPe: 'Exit Mach number and area ratio from the exit pressure, by the isentropic relation.',
    rkOptimum:
      'Optimum expansion: the exit pressure equals the ambient pressure, which gives the largest thrust at ' +
      'this altitude.',
    rkExitPressure: 'Exit pressure from the isentropic expansion.',
    rkCF: 'Thrust coefficient: the momentum term plus the pressure term.',
    rkIsp: 'Specific impulse from c* and C_F.',
    rkThrust: 'Thrust and mass flow from the throat area.',
    rkSeparation:
      'pe/pa = {ratio} is below about 0.4, so the flow will likely separate from the nozzle wall (Summerfield ' +
      'criterion). The ideal thrust above assumes it does not.',
    rkNoSeparation:
      'pe/pa = {ratio}, above about 0.4, so the flow should stay attached to the wall (Summerfield criterion).',
    rkDeltaV: 'Ideal velocity change from the Tsiolkovsky rocket equation, with no gravity or drag losses.',
  },
  e: {
    massRatio: 'The mass ratio m₀/mf must be at least 1.',
    optimumVacuum:
      'Optimum expansion needs an ambient pressure above zero; in a vacuum the ideal nozzle would be ' +
      'infinitely long.',
    exitPressureHigh: 'The exit pressure must be below the sonic pressure, {max} Pa, for a supersonic nozzle.',
  },
} as const;
