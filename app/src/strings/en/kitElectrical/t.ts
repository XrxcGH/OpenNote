// Tool titles, keywords, and one-line descriptions. Part of the kitElectrical namespace.
export const t = {
    transients: {
      title: 'First- and second-order circuits',
      short: 'Transients',
      keywords: 'rc rl rlc transient step response natural time constant damping underdamped overdamped switching',
      about: 'Natural and step responses of RC, RL, and series or parallel RLC circuits.',
    },
    instruments: {
      title: 'Instrumentation and measurement',
      short: 'Instruments',
      keywords:
        'resistor color code bridge strain gauge thermocouple rtd pt100 rms decibel oscilloscope adc quantization',
      about: 'Resistor codes, bridges and strain gauges, thermocouples, RTDs, signal levels, and converter resolution.',
    },

    acpower: {
      title: 'AC power and three-phase systems',
      short: 'AC power',
      keywords:
        'complex power real reactive apparent power factor correction capacitor three-phase wye delta per-unit pu base',
      about: 'Power triangles, power factor correction, balanced three-phase loads, and the per-unit system.',
    },

    energy: {
      title: 'Energy systems and the environment',
      short: 'Energy',
      keywords:
        'wind turbine betz weibull rayleigh capacity factor solar sun declination pv emissions co2 lcoe kwh btu',
      about: 'Wind and solar estimates, emissions per kilowatt-hour, the cost of energy, and energy unit conversion.',
    },

    opamps: {
      title: 'Op-amp circuits and filters',
      short: 'Op-amps',
      keywords:
        'op-amp summing difference instrumentation integrator differentiator sallen-key butterworth chebyshev filter',
      about:
        'Ideal op-amp stages, active filter sections, the order and poles a filter specification needs, and passive RC and RLC filters.',
    },

    semis: {
      title: 'Diodes and transistors',
      short: 'Semiconductors',
      keywords: 'diode shockley zener regulator rectifier ripple bjt mosfet bias gm small-signal common-emitter',
      about: 'Diode and zener circuits, rectifier ripple, and the bias point and gain of BJT and MOSFET amplifiers.',
    },

    powerflow: {
      title: 'Power flow and economic dispatch',
      short: 'Power flow',
      keywords:
        'load flow newton-raphson gauss-seidel ybus admittance dc power flow economic dispatch lambda generator cost grid',
      about: 'Voltages and line flows of a small network, and the cheapest way for generators to meet a demand.',
    },

    labfit: {
      title: 'Lab data fitting and uncertainty',
      short: 'Data fitting',
      keywords:
        'least squares regression fit line chi-square residuals uncertainty error bars exponential power levenberg',
      about: 'Fit a line, polynomial, exponential, power law, or your own formula to lab data with uncertainties.',
    },

    netlist: {
      title: 'Circuit simulator',
      short: 'Simulator',
      keywords:
        'spice netlist circuit simulator nodal mna ac sweep bode transient thevenin norton op-amp rlc phasor impedance',
      about:
        'Type a circuit as a short netlist, then find its DC operating point, AC sweep, transient response, or Thevenin equivalent.',
    },
} as const;
