// Standard atmosphere: the tool's labels, results, plots, and worked steps (kitAero.t.atmosphere).
export const atmosphere = {
  title: 'Standard atmosphere',
  short: 'Atmosphere',
  keywords: 'standard atmosphere isa altitude density altitude pressure altitude speed of sound viscosity lapse rate',
  about: 'Air temperature, pressure, density, speed of sound and viscosity at altitude, or the altitude for a value.',
  assume:
    'U.S. Standard Atmosphere 1976 from −5 km to 86 km: dry air as an ideal gas with R = 287.053 J/(kg K) and ' +
    'γ = 1.4, in hydrostatic balance. An offset ΔT shifts the temperature at standard pressure.',
  f: {
    mode: 'Find the state from',
    altitude: 'Altitude',
    kind: 'Altitude measured as',
    pressure: 'Pressure',
    density: 'Density',
    temperature: 'Temperature',
    dT: 'Temperature offset ΔT',
  },
  o: {
    altitude: 'Altitude',
    pressure: 'Pressure (pressure altitude)',
    density: 'Density (density altitude)',
    temperature: 'Temperature (troposphere only)',
    geometric: 'Geometric (height above sea level)',
    geopotential: 'Geopotential',
  },
  r: {
    layer: 'Layer',
    z: 'Geometric altitude z',
    H: 'Geopotential altitude H',
    T: 'Temperature T',
    p: 'Pressure p',
    rho: 'Density ρ',
    a: 'Speed of sound a',
    mu: 'Dynamic viscosity μ',
    nu: 'Kinematic viscosity ν',
    g: 'Gravity g',
    theta: 'Temperature ratio θ = T/T₀',
    delta: 'Pressure ratio δ = p/p₀',
    sigma: 'Density ratio σ = ρ/ρ₀',
  },
  p: {
    tTitle: 'Temperature',
    pTitle: 'Pressure',
    rhoTitle: 'Density',
    H: 'Geopotential altitude H, km',
    T: 'Temperature, K',
    p: 'Pressure, kPa',
    rho: 'Density, kg/m³',
    standard: 'Standard day',
    here: 'This state',
  },
  s: {
    atmGeopotential: 'Convert the geometric altitude z to geopotential altitude H, with r₀ = 6356.766 km.',
    atmInvertPressure:
      'Find the altitude where the standard pressure is {value} Pa (the pressure altitude), by Brent’s method.',
    atmInvertDensity: 'Find the altitude where the density is {value} kg/m³ (the density altitude), by Brent’s method.',
    atmInvertTemperature: 'Find the altitude in the troposphere where the temperature is {value} K, by Brent’s method.',
    atmLayer:
      'The altitude is in the {layer} layer: base {base} km, base temperature {Tb} K, base pressure {pb} Pa, ' +
      'lapse rate {lapse} K/km.',
    atmTemperature: 'Temperature varies linearly with geopotential altitude in the layer.',
    atmOffset:
      'Add the temperature offset. Pressure stays at its standard value; density follows from the new ' +
      'temperature.',
    atmPressureIso: 'The layer is isothermal, so the hydrostatic equation gives an exponential pressure decay.',
    atmPressureLapse: 'The layer has a constant lapse rate L, so the hydrostatic equation gives a power law.',
    atmKinetic:
      'Above 80 km the mean molecular weight M falls below its sea-level value M₀, so the kinetic temperature is ' +
      'T = TM M/M₀ (USSA 1976 Table 8). The layer temperature above is TM; the standard defines density and the ' +
      'speed of sound with TM, and viscosity uses T.',
    atmDensity: 'Density from the ideal gas law, with R = 8314.32/28.9644 = 287.053 J/(kg K).',
    atmSound: 'Speed of sound for air as a calorically perfect gas, γ = 1.4.',
    atmViscosity: 'Dynamic viscosity by Sutherland’s law, β = 1.458 × 10⁻⁶ kg/(m s K^½) and S = 110.4 K.',
  },
  e: {
    altitudeRange: 'The standard atmosphere covers −5 km to 86 km geometric altitude (84.852 km geopotential).',
    inverseRange: 'No altitude between −5 km and 86 km has that value.',
    temperatureRange:
      'In the troposphere the temperature runs from {lo} K to {hi} K. Above it the temperature is not unique, ' +
      'so enter an altitude instead.',
    temperatureNegative: 'The temperature offset makes the absolute temperature zero or negative.',
  },
  layer: {
    troposphere: 'troposphere',
    tropopause: 'tropopause',
    stratosphere: 'lower stratosphere',
    stratosphere2: 'upper stratosphere',
    stratopause: 'stratopause',
    mesosphere: 'lower mesosphere',
    mesosphere2: 'upper mesosphere',
  },
} as const;
