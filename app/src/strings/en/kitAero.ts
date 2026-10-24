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
    compressible: {
      title: 'Compressible flow relations',
      short: 'Compressible flow',
      keywords:
        'gas dynamics compressible flow isentropic normal shock oblique shock theta beta mach prandtl meyer ' +
        'expansion fanno rayleigh area ratio',
      about:
        'Every ratio of a compressible flow family from one known value: isentropic flow, shocks, expansion fans, ' +
        'and duct flow with friction or heating.',
      assume:
        'Steady one-dimensional flow of a calorically perfect gas with constant γ. Isentropic flow is adiabatic ' +
        'and reversible. Shocks are adiabatic and thin. Fanno flow is adiabatic with wall friction and Rayleigh ' +
        'flow is frictionless with heat transfer, both in a constant-area duct. Starred values are at the sonic ' +
        'state, M = 1. Angles are in degrees.',
      f: {
        family: 'Relation',
        kisentropic: 'Known value',
        knormal: 'Known value',
        koblique: 'Known value',
        kexpansion: 'Known value',
        kfanno: 'Known value',
        krayleigh: 'Known value',
        value: 'Value',
        M1: 'Upstream Mach number M₁',
        branch: 'Branch',
        solution: 'Shock solution',
        gamma: 'Ratio of specific heats γ',
      },
      h: {
        value: 'A ratio, a Mach number, or an angle in degrees.',
        gamma: 'Air is 1.4; a monatomic gas is 5/3.',
      },
      o: {
        isentropic: 'Isentropic flow',
        normal: 'Normal shock',
        oblique: 'Oblique shock',
        expansion: 'Prandtl-Meyer expansion',
        fanno: 'Fanno flow (friction)',
        rayleigh: 'Rayleigh flow (heat transfer)',
        subsonic: 'Subsonic',
        supersonic: 'Supersonic',
        weak: 'Weak (the usual one)',
        strong: 'Strong',
        M: 'Mach number M',
        TT0: 'T/T₀',
        pp0: 'p/p₀',
        rhorho0: 'ρ/ρ₀',
        AA: 'A/A*',
        mu: 'Mach angle μ',
        nu: 'Prandtl-Meyer angle ν',
        M1: 'Upstream Mach number M₁',
        M2: 'Downstream Mach number M₂',
        p2p1: 'p₂/p₁',
        rho2rho1: 'ρ₂/ρ₁',
        T2T1: 'T₂/T₁',
        p02p01: 'p₀₂/p₀₁',
        theta: 'Deflection angle θ',
        beta: 'Wave angle β',
        fLD: '4fL*/D',
        TTs: 'T/T*',
        pps: 'p/p*',
        p0p0s: 'p₀/p₀*',
        T0T0s: 'T₀/T₀*',
      },
      r: {
        M: 'Mach number M',
        TT0: 'Temperature ratio T/T₀',
        pp0: 'Pressure ratio p/p₀',
        rhorho0: 'Density ratio ρ/ρ₀',
        AA: 'Area ratio A/A*',
        mu: 'Mach angle μ',
        nu: 'Prandtl-Meyer angle ν',
        M1: 'Upstream Mach number M₁',
        M2: 'Downstream Mach number M₂',
        p2p1: 'Pressure ratio p₂/p₁',
        rho2rho1: 'Density ratio ρ₂/ρ₁',
        T2T1: 'Temperature ratio T₂/T₁',
        p02p01: 'Stagnation pressure ratio p₀₂/p₀₁',
        p02p1: 'Pitot pressure ratio p₀₂/p₁',
        beta: 'Wave angle β',
        theta: 'Deflection angle θ',
        M1n: 'Normal Mach number ahead, M₁ₙ',
        M2n: 'Normal Mach number behind, M₂ₙ',
        thetaMax: 'Largest attached deflection θmax',
        betaMax: 'Wave angle at θmax',
        fLD: 'Friction length to choking 4fL*/D',
        TTs: 'Temperature ratio T/T*',
        pps: 'Pressure ratio p/p*',
        rhorhos: 'Density ratio ρ/ρ*',
        p0p0s: 'Stagnation pressure ratio p₀/p₀*',
        T0T0s: 'Stagnation temperature ratio T₀/T₀*',
      },
      p: {
        isentropic: 'Isentropic flow',
        normal: 'Normal shock',
        oblique: 'Deflection against wave angle',
        expansion: 'Prandtl-Meyer function',
        fanno: 'Fanno flow',
        rayleigh: 'Rayleigh flow',
        M: 'Mach number M',
        M1: 'Upstream Mach number M₁',
        beta: 'Wave angle β, °',
        ratio: 'Ratio',
        thetaDeg: 'Deflection θ, °',
        nuDeg: 'Prandtl-Meyer angle ν, °',
        TT0: 'T/T₀',
        pp0: 'p/p₀',
        rhorho0: 'ρ/ρ₀',
        AA: 'A/A* (up to 6)',
        M2: 'M₂',
        p02p01: 'p₀₂/p₀₁',
        theta: 'θ at this M₁',
        nu: 'ν',
        fLD: '4fL*/D',
        T0T0s: 'T₀/T₀*',
        here: 'This state',
        thetaMax: 'θmax',
      },
      s: {
        cfInverse:
          'Solve for M on the {branch} branch by Brent’s method, searching M from {lo} to {hi}: M = {M} after ' +
          '{iterations} iterations.',
        cfIsenT: 'Static to stagnation temperature for isentropic flow of a calorically perfect gas.',
        cfIsenP: 'Pressure ratio from the temperature ratio.',
        cfIsenRho: 'Density ratio from the temperature ratio.',
        cfIsenA: 'Area ratio to the sonic throat A*.',
        cfMachAngle: 'Mach angle of the supersonic flow.',
        cfNormalM2: 'Mach number behind the normal shock.',
        cfNormalP: 'Static pressure jump across the shock.',
        cfNormalRho: 'Density and temperature jumps across the shock.',
        cfNormalP0: 'Stagnation pressure ratio: the shock is adiabatic but not isentropic, so p₀ falls.',
        cfObliqueSolve:
          'Solve the θ-β-M relation for the {branch} wave angle β by Brent’s method ({iterations} iterations).',
        cfThetaMax: 'Largest deflection with an attached shock at this Mach number, by golden-section search.',
        cfObliqueNormal: 'The normal component of the upstream Mach number goes through a normal shock.',
        cfObliqueM2: 'Downstream Mach number from its normal component and the turned flow direction.',
        cfPrandtlMeyer: 'Prandtl-Meyer function: the turning angle from M = 1. The largest possible turn is {max}°.',
        cfFanno: 'Fanno flow: the duct length (as 4fL*/D) that brings the flow to M = 1 by friction.',
        cfFannoRatios: 'Temperature and pressure relative to the sonic state.',
        cfFannoP0: 'Stagnation pressure ratio; friction always lowers p₀.',
        cfRayleighP: 'Rayleigh flow: pressure and temperature relative to the sonic state.',
        cfRayleighT0: 'Stagnation temperature ratio: heating drives the flow toward M = 1.',
        cfRayleighP0: 'Stagnation pressure ratio.',
      },
      e: {
        unknownInput: 'That value cannot be the known for this relation.',
        shockSubsonic: 'A normal shock needs a supersonic upstream flow: M₁ must be at least 1.',
        expansionSubsonic: 'The Prandtl-Meyer function is defined for M of 1 or more.',
        obliqueSubsonic: 'An oblique shock needs a supersonic upstream flow: M₁ must be greater than 1.',
        machTooLarge: 'The Mach number must be at most {max}.',
        valueRange: 'On the {branch} branch, {name} must be between {lo} and {hi}.',
        detached: 'The deflection is larger than θmax = {max}°, so the shock detaches and stands off as a bow shock.',
        betaRange: 'The wave angle must be between the Mach angle, {lo}°, and {hi}°.',
      },
      branch: {
        subsonic: 'subsonic',
        supersonic: 'supersonic',
        weak: 'weak',
        strong: 'strong',
      },
    },
    nozzle: {
      title: 'Nozzle and diffuser flow',
      short: 'Nozzle',
      keywords:
        'converging diverging nozzle de laval choked flow critical pressure ratio normal shock overexpanded ' +
        'underexpanded back pressure mass flow diffuser',
      about:
        'A converging-diverging nozzle at any back pressure: whether it chokes, where a shock stands, the exit ' +
        'state, and the mass flow.',
      assume:
        'Quasi-one-dimensional steady flow of a calorically perfect gas, isentropic except across a normal shock. ' +
        'The walls are drawn parabolic for the pressure plot; the results depend only on the area ratio. The gas ' +
        'leaves into a still back pressure. Oblique shocks and expansion fans outside the exit are named but not ' +
        'solved.',
      f: {
        areaRatio: 'Exit to throat area ratio Ae/At',
        throat: 'Throat area At',
        p0: 'Stagnation pressure p₀',
        T0: 'Stagnation temperature T₀',
        pb: 'Back pressure pb',
        gamma: 'Ratio of specific heats γ',
        R: 'Gas constant R',
      },
      h: {
        R: 'Air is 287 J/(kg K).',
      },
      r: {
        pbp0: 'Back pressure ratio pb/p₀',
        c1: 'First critical pb/p₀ (choked, subsonic exit)',
        c2: 'Second critical pb/p₀ (shock at the exit)',
        c3: 'Third critical pb/p₀ (design)',
        Me: 'Exit Mach number Me',
        pe: 'Exit pressure pe',
        Te: 'Exit temperature Te',
        Ve: 'Exit velocity Ve',
        mdot: 'Mass flow ṁ',
        As: 'Shock area ratio As/At',
        xs: 'Shock position along the diverging section (0 throat, 1 exit)',
        M1: 'Mach number ahead of the shock',
        p02p01: 'Stagnation pressure ratio across the shock',
      },
      p: {
        pressure: 'Pressure along the nozzle',
        area: 'Nozzle area',
        x: 'Position: −1 inlet, 0 throat, 1 exit',
        pp0: 'Pressure ratio p/p₀',
        AAt: 'Area ratio A/At',
        shock: 'Shock',
        back: 'Back pressure',
      },
      s: {
        nzFirst:
          'First critical back pressure: the throat just chokes and the whole nozzle stays subsonic. Ae/At = {e} ' +
          'on the subsonic branch gives the exit Mach number.',
        nzThird: 'Third critical (design) back pressure: fully supersonic isentropic flow in the diverging section.',
        nzSecond: 'Second critical back pressure: a normal shock stands exactly at the exit plane.',
        nzSubsonic:
          'pb/p0 = {r} is above the first critical value {c1}, so the throat is not choked and the exit pressure ' +
          'equals pb.',
        nzChokedSub: 'pb/p0 = {r} equals the first critical value: the throat is sonic and the exit is subsonic.',
        nzShockRegime:
          'pb/p0 = {r} lies between the second ({c2}) and first ({c1}) critical values, so a normal shock stands ' +
          'inside the diverging section.',
        nzShockSolve:
          'Place the shock by Brent’s method so that the exit pressure equals pb. The stagnation pressure loss ' +
          'enlarges the sonic area downstream. The shock sits at As/At = {As} after {iterations} iterations.',
        nzShockResult:
          'Mach number just ahead of the shock, the stagnation pressure ratio across it, and the subsonic exit ' +
          'Mach number.',
        nzShockExit: 'pb/p0 = {r} equals the second critical value: the normal shock sits at the exit plane.',
        nzOver:
          'pb/p0 = {r} lies between the design value {c3} and the second critical value {c2}: the nozzle is ' +
          'overexpanded and oblique shocks form outside the exit.',
        nzUnder:
          'pb/p0 = {r} is below the design value {c3}: the nozzle is underexpanded and expansion fans form outside ' +
          'the exit.',
        nzDesign: 'pb/p0 = {r} equals the design value: the jet leaves at the back pressure with no waves.',
        nzMassFlow: 'Mass flow through the sonic throat A* (the throat area when choked).',
      },
      e: {
        backflow: 'The back pressure is above the stagnation pressure, so the flow would run backward.',
      },
      regime: {
        noFlow: 'No flow: the back pressure equals the stagnation pressure.',
        subsonic: 'Subsonic throughout: the throat is not choked (a venturi).',
        chokedSubsonic: 'Choked, with a subsonic exit (first critical point).',
        shockInside: 'Choked, with a normal shock inside the diverging section.',
        shockAtExit: 'Choked, with a normal shock at the exit plane (second critical point).',
        overexpanded: 'Overexpanded: supersonic exit, oblique shocks outside the nozzle.',
        design: 'Design condition: the exit pressure equals the back pressure.',
        underexpanded: 'Underexpanded: supersonic exit, expansion fans outside the nozzle.',
      },
    },
  },
} as const;
