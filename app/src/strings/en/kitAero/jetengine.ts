// Jet engine cycle analysis: the tool's labels, results, plots, and worked steps (kitAero.t.jetengine).
export const jetengine = {
  title: 'Jet engine cycle analysis',
  short: 'Jet engine',
  keywords:
    'jet engine cycle analysis parametric turbojet turbofan ramjet afterburner specific thrust tsfc fuel ' +
    'consumption thermal propulsive overall efficiency bypass ratio compressor pressure ratio station tau pi',
  about:
    'On-design cycle analysis of a turbojet, turbofan, or ramjet: specific thrust, fuel consumption, ' +
    'efficiencies, and the total temperature and pressure at each station.',
  assume:
    'Steady, one-dimensional flow, on design. Ideal cycle: every component is reversible, the gas is one ' +
    'calorically perfect gas, the nozzles expand to ambient, and the fuel’s mass is neglected. Non-ideal ' +
    'cycle: polytropic efficiencies, an efficiency for each burner and the shaft, pressure ratios for each duct, a ' +
    'separate cp and γ from the burner on (the afterburner uses the same hot gas), the fuel’s mass carried ' +
    'through, and the military specification ram recovery above Mach 1. The compressor pressure ratio is the ' +
    'overall ratio Pt3/Pt2, which includes the fan’s core stream; the turbofan has separate exhausts. Specific ' +
    'thrust is per unit of total air mass flow (core plus bypass).',
  f: {
    type: 'Engine',
    model: 'Cycle',
    afterburner: 'Afterburner',
    ambient: 'Ambient conditions from',
    altitude: 'Altitude (geometric)',
    T0: 'Ambient temperature T₀',
    P0: 'Ambient pressure P₀',
    M0: 'Flight Mach number M₀',
    Tt4: 'Turbine inlet total temperature Tt4',
    piC: 'Compressor pressure ratio πc',
    piF: 'Fan pressure ratio πf',
    alpha: 'Bypass ratio α',
    Tt7: 'Afterburner exit total temperature Tt7',
    hPR: 'Fuel heating value hPR',
    gammaC: 'γ before the burner, γc',
    cpC: 'cp before the burner, cpc',
    gammaT: 'γ from the burner on, γt',
    cpT: 'cp from the burner on, cpt',
    piDmax: 'Diffuser pressure ratio πd,max',
    piB: 'Burner pressure ratio πb',
    piN: 'Core nozzle pressure ratio πn',
    piFn: 'Fan nozzle pressure ratio πfn',
    ec: 'Compressor polytropic efficiency ec',
    ef: 'Fan polytropic efficiency ef',
    et: 'Turbine polytropic efficiency et',
    etaB: 'Burner efficiency ηb',
    etaM: 'Mechanical efficiency ηm',
    etaAB: 'Afterburner efficiency ηAB',
    piAB: 'Afterburner pressure ratio πAB',
    p0p9: 'Core exit pressure ratio P₀/P₉',
    p0p19: 'Fan exit pressure ratio P₀/P₁₉',
    m0: 'Total air mass flow ṁ₀ (optional)',
  },
  h: {
    piC: 'Overall, Pt3/Pt2.',
    p0p9: '1 when the nozzle expands to ambient pressure.',
    p0p19: '1 when the nozzle expands to ambient pressure.',
    m0: 'Leave blank for results per unit of air flow.',
  },
  o: {
    turbojet: 'Turbojet',
    turbofan: 'Turbofan, separate exhausts',
    ramjet: 'Ramjet',
    ideal: 'Ideal',
    real: 'Non-ideal',
    off: 'Off',
    on: 'On',
    altitude: 'Standard atmosphere',
    typed: 'Values I type',
  },
  r: {
    specificThrust: 'Specific thrust F/ṁ₀',
    S: 'Thrust specific fuel consumption S',
    f: 'Fuel-air ratio f',
    fAB: 'Afterburner fuel-air ratio f_AB',
    fO: 'Overall fuel-air ratio f_O',
    etaTh: 'Thermal efficiency ηT',
    etaP: 'Propulsive efficiency ηP',
    etaO: 'Overall efficiency ηO',
    V9: 'Core exhaust velocity V₉',
    M9: 'Core exhaust Mach number M₉',
    V19: 'Fan exhaust velocity V₁₉',
    FR: 'Thrust ratio, core over fan',
    V0: 'Flight speed V₀',
    T0: 'Ambient temperature T₀',
    P0: 'Ambient pressure P₀',
    tauR: 'Ram temperature ratio τr',
    piR: 'Ram pressure ratio πr',
    piD: 'Diffuser pressure ratio πd',
    tauL: 'Burner enthalpy ratio τλ',
    tauC: 'Compressor temperature ratio τc',
    etaC: 'Compressor adiabatic efficiency ηc',
    tauF: 'Fan temperature ratio τf',
    etaF: 'Fan adiabatic efficiency ηf',
    tauT: 'Turbine temperature ratio τt',
    piT: 'Turbine pressure ratio πt',
    etaT: 'Turbine adiabatic efficiency ηt',
    thrust: 'Thrust F',
    fuelFlow: 'Fuel flow ṁf',
  },
  tb: {
    stations: 'Stations',
    station: 'Station',
    Tt: 'Total temperature Tt',
    Pt: 'Total pressure Pt',
  },
  st: {
    '0': '0, free stream',
    '2': '2, compressor face',
    '13': '13, fan exit',
    '3': '3, compressor exit',
    '4': '4, burner exit',
    '5': '5, turbine exit',
    '7': '7, afterburner exit',
    '9': '9, core nozzle exit',
    '19': '19, fan nozzle exit',
  },
  p: {
    sweepF: 'Specific thrust against compressor pressure ratio',
    sweepS: 'Fuel consumption against compressor pressure ratio',
    sweepFRam: 'Specific thrust against flight Mach number',
    sweepSRam: 'Fuel consumption against flight Mach number',
    piC: 'Compressor pressure ratio πc',
    M0: 'Flight Mach number M₀',
    F: 'F/ṁ₀, N s/kg',
    S: 'S, mg/(N s)',
    design: 'This design',
  },
  n: {
    noThrust: 'The exhaust leaves no faster than the flight speed, so this engine gives no thrust.',
  },
  w: {
    expanded: 'The nozzles expand to ambient pressure, so there is no pressure thrust.',
    pressureTerm: 'A nozzle that does not expand to ambient adds a pressure term to each stream.',
  },
  s: {
    jeRam: 'Free stream: a₀ = {a0} m/s and V₀ = {V0} m/s. Ram temperature and pressure ratios.',
    jeDiffuser: 'Diffuser: ram recovery ηr = {etaR}, times the diffuser’s own pressure ratio.',
    jeTauL: 'Burner exit enthalpy over ambient enthalpy.',
    jeCompressor: 'Compressor temperature ratio from its pressure ratio; adiabatic efficiency ηc = {etaC}.',
    jeFan: 'Fan temperature ratio from its pressure ratio; adiabatic efficiency ηf = {etaF}.',
    jeFuel: 'Fuel-air ratio from the burner’s energy balance.',
    jeTurbine:
      'Turbine temperature ratio: the turbine’s work drives the compressor and the fan. Adiabatic efficiency ' +
      'ηt = {etaT}.',
    jeAfterburner: 'Afterburner: τλAB = {tauLAB}, so its fuel-air ratio is as shown; overall f_O = {fO}.',
    jeCoreNozzle: 'Core nozzle: V₉ = {V9} m/s, at a static temperature T₉ = {T9} K.',
    jeFanNozzle: 'Fan nozzle: V₁₉ = {V19} m/s.',
    jeThrust: 'Specific thrust from the change in momentum of each stream. {pressure}',
    jeTsfc: 'Thrust specific fuel consumption: fuel flow over thrust.',
    jeEfficiency:
      'Thermal efficiency: kinetic energy added over fuel energy. Propulsive efficiency: thrust power over ' +
      'kinetic energy added.',
  },
  e: {
    ramjetStatic: 'A ramjet needs forward speed to compress its air. Enter a flight Mach number above 0.',
    ratioBelowOne: '{name} must be at least 1.',
    burnerCold:
      'Tt4 must be above the compressor exit temperature, Tt3 = {Tt3} K, or the burner would have to remove ' +
      'heat. Raise Tt4 or lower the pressure ratio.',
    fuelTooHot: 'The fuel cannot heat the gas to this temperature. Lower Tt4 or raise the heating value.',
    turbineWork:
      'The turbine cannot drive the compressor and fan: they need more work than the hot gas holds. Raise ' +
      'Tt4, or lower the pressure ratios or the bypass ratio.',
    afterburnerCold: 'Tt7 must be above the turbine exit temperature, Tt5 = {Tt5} K.',
    coreExpand:
      'The core stream cannot reach the exit pressure: Pt9/P9 = {ratio}, at most 1. The turbine leaves too ' +
      'little pressure; lower the fan pressure ratio or the bypass ratio, or raise Tt4.',
    fanExpand: 'The fan stream cannot reach the exit pressure: Pt19/P19 = {ratio}, at most 1.',
  },
} as const;
