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
    rocket: {
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
        H: 'Geopotential altitude H, km',
        F: 'Thrust F, kN',
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
    },
    wing: {
      title: 'Finite wings',
      short: 'Finite wing',
      keywords:
        'finite wing lifting line prandtl glauert induced drag downwash span efficiency oswald elliptic lift ' +
        'distribution taper twist washout aspect ratio',
      about:
        'Lift, induced drag, and span efficiency of a straight wing by Prandtl’s lifting-line theory, with the ' +
        'spanwise load.',
      assume:
        'Incompressible, inviscid flow past an unswept wing of moderate to high aspect ratio. The section lift ' +
        'slope and zero-lift angle are the same across the span, and the twist grows linearly from root to tip. ' +
        'Induced drag only: add the section profile drag for the total. Angles are measured at the root.',
      f: {
        planform: 'Planform',
        span: 'Span b',
        area: 'Wing area S',
        taper: 'Taper ratio λ = c_tip/c_root',
        twist: 'Tip twist (washout is negative)',
        a0: 'Section lift slope a₀, per radian',
        alphaL0: 'Section zero-lift angle αL0',
        alpha: 'Angle of attack α',
        terms: 'Number of sine terms N',
        V: 'Airspeed V (optional, for forces)',
        rho: 'Air density ρ (for forces)',
      },
      h: {
        a0: 'Thin airfoil theory gives 2π, typed as 2*pi.',
        terms: '40 is plenty; more terms change the answer very little.',
      },
      o: {
        tapered: 'Straight-tapered (1 is rectangular)',
        elliptic: 'Elliptic',
      },
      r: {
        AR: 'Aspect ratio AR = b²/S',
        CL: 'Lift coefficient CL',
        CDi: 'Induced drag coefficient CDi',
        e: 'Span efficiency e',
        delta: 'Induced drag factor δ',
        a: 'Wing lift slope a',
        aDeg: 'Wing lift slope a',
        alphaL0Wing: 'Wing zero-lift angle',
        A1: 'First coefficient A₁',
        lift: 'Lift L',
        drag: 'Induced drag Di',
      },
      p: {
        load: 'Spanwise load',
        cl: 'Section lift coefficient',
        y: 'Span station 2y/b',
        loadAxis: 'Load c·cl/(c_mean·CL)',
        clAxis: 'Section cl',
        elliptic: 'Elliptic load',
      },
      s: {
        wgMonoplane:
          'Glauert’s monoplane equation, written at {N} stations across the half span (the wing is symmetric, so ' +
          'only odd terms appear). Aspect ratio AR = b²/S = {AR}.',
        wgA1: 'Solve the linear equations by LU decomposition for the coefficients. The first few are shown.',
        wgCL: 'Wing lift coefficient from the first coefficient.',
        wgDelta: 'Induced drag factor δ from the higher terms, and the span efficiency e.',
        wgCDi: 'Induced drag coefficient.',
        wgSlope: 'Lift slope of the finite wing, compared with the elliptic-wing formula.',
        wgForces: 'Lift and induced drag at dynamic pressure q = {q} Pa.',
      },
      e: {
        taperRange: 'The taper ratio must be between 0 and 1.',
        termsRange: 'Use between 2 and 200 terms.',
        aspectRange: 'The aspect ratio must be at most 100.',
      },
    },
    performance: {
      title: 'Aircraft performance and static stability',
      short: 'Performance',
      keywords:
        'aircraft performance drag polar thrust required power required lift to drag breguet range endurance climb ' +
        'rate glide turn radius load factor neutral point static margin stability',
      about:
        'Best speeds from the drag polar, range and endurance, climb and glide, turns, and the neutral point and ' +
        'static margin.',
      assume:
        'Steady flight with a parabolic drag polar CD = CD0 + k CL², constant over the speeds used. Range and ' +
        'endurance hold the altitude and the lift coefficient (the jet also shows a cruise climb), with constant ' +
        'fuel consumption and propeller efficiency. Climbs are at small angles. Turns are level and coordinated. ' +
        'Stability is stick fixed. Weight is a force, and g₀ = 9.80665 m/s².',
      f: {
        mode: 'Find',
        W: 'Weight W',
        S: 'Wing area S',
        CD0: 'Zero-lift drag coefficient CD0',
        kFrom: 'Drag due to lift from',
        k: 'Induced drag factor k',
        e: 'Oswald efficiency e',
        AR: 'Aspect ratio AR',
        air: 'Air density from',
        altitude: 'Altitude (standard atmosphere)',
        rho: 'Air density ρ',
        engine: 'Engine',
        fuel: 'Fuel burned, as a fraction of the starting weight',
        ct: 'Thrust-specific fuel consumption ct',
        cp: 'Power-specific fuel consumption c',
        etaP: 'Propeller efficiency ηp',
        T: 'Thrust available T',
        P: 'Power available P (after propeller losses)',
        height: 'Height for the glide range (optional)',
        V: 'Airspeed V',
        bank: 'Bank angle φ',
        hac: 'Wing-body aerodynamic center h_ac (fraction of chord)',
        VH: 'Tail volume ratio V_H',
        slopeRatio: 'Lift slope ratio a_t/a',
        downwash: 'Downwash gradient dε/dα',
        hcg: 'Center of gravity h_cg (fraction of chord)',
        a: 'Wing-body lift slope a, per radian (optional)',
      },
      h: {
        ct: 'Weight of fuel per unit thrust per hour.',
        cp: 'Weight of fuel per unit of shaft energy.',
        a: 'Gives the pitching moment slope.',
      },
      o: {
        polar: 'Best speeds from the drag polar',
        range: 'Range and endurance',
        climb: 'Climb and glide',
        turn: 'Level turn',
        stability: 'Static stability',
        k: 'k directly',
        eAR: 'Oswald efficiency and aspect ratio',
        altitude: 'Altitude',
        density: 'Density',
        jet: 'Jet',
        prop: 'Propeller',
      },
      r: {
        rho: 'Air density ρ',
        k: 'Induced drag factor k',
        LDmax: 'Maximum lift to drag ratio (L/D)max',
        CLminD: 'Lift coefficient for minimum drag CL*',
        VminD: 'Minimum drag speed',
        Dmin: 'Minimum drag',
        CLminP: 'Lift coefficient for minimum power',
        VminP: 'Minimum power speed',
        Pmin: 'Minimum power required',
        LDminP: 'L/D at minimum power',
        wingLoading: 'Wing loading W/S',
        CLrange: 'Lift coefficient for best range',
        CDrange: 'Drag coefficient for best range',
        range: 'Range',
        rangeCruiseClimb: 'Range in a cruise climb',
        CLendurance: 'Lift coefficient for best endurance',
        endurance: 'Endurance',
        Wf: 'Final weight',
        maxClimbRate: 'Maximum rate of climb',
        speedForMaxClimb: 'Speed for the maximum rate of climb',
        maxClimbAngle: 'Steepest climb angle',
        glideAngle: 'Flattest glide angle',
        minSinkRate: 'Minimum sink rate',
        minSinkSpeed: 'Speed for the minimum sink rate',
        glideRange: 'Glide range',
        n: 'Load factor n',
        radius: 'Turn radius',
        turnRate: 'Turn rate',
        hn: 'Neutral point h_n',
        margin: 'Static margin h_n − h_cg',
        CmAlpha: 'Pitching moment slope CMα',
      },
      p: {
        thrust: 'Thrust required',
        power: 'Power required',
        V: 'Airspeed V, m/s',
        D: 'Thrust required, kN',
        P: 'Power required, kW',
        minD: 'Minimum drag',
        minP: 'Minimum power',
      },
      n: {
        stable: 'Statically stable: the center of gravity is ahead of the neutral point.',
        unstable: 'Statically unstable: the center of gravity is at or behind the neutral point.',
      },
      s: {
        pfPolar: 'Parabolic drag polar: zero-lift drag plus drag due to lift.',
        pfMinDrag: 'Minimum drag (maximum L/D) happens where zero-lift drag equals drag due to lift.',
        pfSpeed: 'Speed for that lift coefficient in level flight, L = W.',
        pfMinPower: 'Minimum power required: drag due to lift is three times the zero-lift drag.',
        pfJetRangeCL: 'Best range for a jet at constant altitude: maximize √CL/CD.',
        pfJetRange: 'Breguet range for a jet at constant altitude and constant CL (the speed falls as fuel burns).',
        pfJetCruiseClimb: 'For comparison, a cruise climb at constant speed and CL, starting at V = {V} m/s.',
        pfJetEndurance: 'Endurance for a jet is longest at (L/D)max.',
        pfPropRange: 'Breguet range for a propeller aircraft is longest at (L/D)max.',
        pfPropEndurance:
          'Endurance for a propeller aircraft at constant altitude is longest at the minimum power lift ' +
          'coefficient, CL = {CL}.',
        pfJetClimb: 'Maximum rate of climb for a jet with constant thrust (small climb angle, parabolic polar).',
        pfJetClimbAngle: 'Steepest climb angle for a jet.',
        pfPropClimb:
          'Maximum rate of climb for a propeller aircraft: the most excess power, at the minimum power speed.',
        pfGlide: 'Flattest glide angle at (L/D)max.',
        pfMinSink: 'Smallest sink rate, at the minimum power speed.',
        pfGlideRange: 'Glide range in still air from the height given.',
        pfLoadFactor: 'Load factor in a level coordinated turn.',
        pfTurnRadius: 'Turn radius.',
        pfTurnRate: 'Turn rate.',
        pfNeutral: 'Neutral point (stick fixed) of the wing, body and tail.',
        pfStable:
          'Static margin is positive: the center of gravity is ahead of the neutral point, so the aircraft is ' +
          'statically stable.',
        pfUnstable:
          'Static margin is zero or negative: the center of gravity is at or behind the neutral point, so the ' +
          'aircraft is statically unstable.',
        pfCmAlpha: 'Pitching moment slope about the center of gravity; it must be negative for static stability.',
      },
      e: {
        oswaldRange: 'The span efficiency factor e must be greater than 0 and at most 1.',
        fuelFraction: 'The fuel fraction must be between 0 and 1.',
        cannotClimb: 'The thrust or power available is too low to hold level flight, so the aircraft cannot climb.',
        bankRange: 'The bank angle must be between 0° and 90°.',
        downwashRange: 'The downwash gradient must be at least 0 and less than 1.',
      },
    },
    potential: {
      title: 'Potential flow',
      short: 'Potential flow',
      keywords:
        'potential flow uniform source sink doublet vortex rankine half body oval cylinder circulation kutta ' +
        'joukowski lift stagnation streamlines stream function complex potential',
      about:
        'Superpose uniform flow, sources, doublets, and vortices to see the streamlines, stagnation points, ' +
        'pressure, and lift.',
      assume:
        'Two-dimensional, steady, incompressible, inviscid, and irrotational flow. A vortex’s strength Γ is ' +
        'positive clockwise, so a positive Γ in a flow from the left lifts upward. Cp uses the free-stream speed. ' +
        'The plot and the stagnation points are in meters, and the element list is read in SI units.',
      f: {
        preset: 'Flow',
        U: 'Free-stream speed U',
        a: 'Cylinder radius a',
        gamma: 'Circulation Γ (clockwise positive)',
        m: 'Source strength m',
        b: 'Half distance between source and sink b',
        elements: 'Elements',
        size: 'Plot half-height',
        px: 'Probe point x',
        py: 'Probe point y',
        rho: 'Air density ρ',
      },
      h: {
        gamma: '4πUa puts both stagnation points together at the bottom.',
        elements:
          'Separate elements with semicolons: uniform U angle; source m x y; sink m x y; doublet κ x y; vortex Γ x ' +
          'y. SI units, angles in degrees.',
      },
      o: {
        cylinder: 'Cylinder (uniform flow and doublet)',
        liftingCylinder: 'Lifting cylinder (with a vortex)',
        halfBody: 'Rankine half-body (uniform flow and source)',
        oval: 'Rankine oval (source and sink)',
        custom: 'My own list of elements',
      },
      r: {
        u: 'Velocity u at the probe',
        v: 'Velocity v at the probe',
        speed: 'Speed at the probe',
        Cp: 'Pressure coefficient Cp at the probe',
        freeStream: 'Free-stream speed',
        circulation: 'Total circulation Γ',
        lift: 'Lift per unit span L′',
        stagnation: 'Stagnation points (x, y), m',
      },
      p: {
        streamlines: 'Streamlines',
        x: 'x, m',
        y: 'y, m',
        psi: 'Streamlines (ψ constant)',
        probe: 'Probe',
      },
      s: {
        pfComplex: 'Add the complex potentials of the {count} elements (vortex strength positive clockwise).',
        pfVelocity: 'The complex velocity is the derivative of W.',
        pfBernoulli: 'Pressure coefficient from Bernoulli’s equation, which holds everywhere in an irrotational flow.',
        pfNoFreeStream: 'There is no uniform flow, so the pressure coefficient has no reference speed.',
        pfKuttaJoukowski:
          'Kutta-Joukowski theorem: the lift per unit span depends only on the total circulation. The drag is zero ' +
          '(d’Alembert’s paradox).',
        pfStagnation: 'Stagnation points, where dW/dz = 0, by complex Newton iteration: {points}.',
      },
      e: {
        noElements: 'Add at least one flow element.',
        elementText: 'Cannot read “{part}”. Write a kind and its numbers, such as source 2*pi 0 0.',
        tooManyElements: 'Use at most 20 flow elements.',
        windowRange: 'The plot window needs a positive width and height.',
        probeOnElement:
          'The probe point sits on a singularity, where the velocity is infinite. Move it off the element.',
      },
    },
  },
} as const;
