// The aerospace kit window (flag kits.aero; owner: the aero lane). It holds the window's own words, the problems any
// tool can report, and one section per tool. A section has the tool's title, fields, result rows, plot labels,
// worked-step sentences, and tool-specific problems. Specs and engines look its keys up by name, such as "r.T".
// Each namespace file has one owner, so parallel work never edits the same file.

export const kitAero = {
  window: 'Aerospace',
  tabs: 'Aerospace tools',
  open: 'Open the aerospace tools',
  openKeywords: 'aerospace aerodynamics gas dynamics propulsion flight mechanics compressible airfoil wing rocket jet',
  loading: 'Loading the tool…',
  units: 'Units',
  si: 'SI',
  us: 'US customary',
  unitOf: 'Unit of {name}',
  assumptions: 'Assumptions',
  results: 'Results',
  value: 'Value',
  steps: 'Worked steps',
  stepsNote: 'Steps are worked in SI units.',
  plots: 'Plots',
  plotLabel: '{title}: {y} against {x}.',
  source: 'Source: {source}',
  problem: 'Cannot calculate yet',
  insert: 'Insert into the page',
  insertAnswer: 'Answer line',
  insertEquation: 'Equation',
  insertTable: 'Result table',
  insertSteps: 'Steps as a list',
  insertPicture: 'Plot as picture',
  inserted: 'Inserted into the page.',
  noPage: 'Click in a page first, then insert.',
  error: {
    notNumber: 'Enter a number in “{name}”.',
    notPositive: '{name} must be greater than zero.',
    notNegative: '{name} cannot be negative.',
    gammaRange: 'γ = {value} is outside the range a gas can have. Use a value above 1 and at most 2 (air is 1.4).',
    noBracket: 'No solution was found in the searched range.',
    singular: 'The equations have no unique solution (the matrix is singular).',
    areaRatioBelowOne: 'A/A* cannot be less than 1: the throat is the smallest section of an isentropic flow.',
    efficiencyRange: '{name} must be greater than 0 and at most 1.',
  },
  t: {
    atmosphere: {
      title: 'Standard atmosphere',
      short: 'Atmosphere',
      keywords:
        'standard atmosphere isa altitude density altitude pressure altitude speed of sound viscosity lapse rate',
      about:
        'Air temperature, pressure, density, speed of sound and viscosity at altitude, or the altitude for a value.',
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
        atmInvertDensity:
          'Find the altitude where the density is {value} kg/m³ (the density altitude), by Brent’s method.',
        atmInvertTemperature:
          'Find the altitude in the troposphere where the temperature is {value} K, by Brent’s method.',
        atmLayer:
          'The altitude is in the {layer} layer: base {base} km, base temperature {Tb} K, base pressure {pb} Pa, ' +
          'lapse rate {lapse} K/km.',
        atmTemperature: 'Temperature varies linearly with geopotential altitude in the layer.',
        atmOffset:
          'Add the temperature offset. Pressure stays at its standard value; density follows from the new ' +
          'temperature.',
        atmPressureIso: 'The layer is isothermal, so the hydrostatic equation gives an exponential pressure decay.',
        atmPressureLapse: 'The layer has a constant lapse rate L, so the hydrostatic equation gives a power law.',
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
    },
  },
} as const;
