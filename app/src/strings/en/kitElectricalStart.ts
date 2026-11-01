// The Electrical kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitElectrical.ts joins this object when the kit's code loads (features/engineering/electrical/text.ts).
import type { kitElectrical as all } from './kitElectrical';

export const kitElectricalStart = {
  window: 'Circuits and energy',
  open: 'Open the circuits and energy tools',
  openKeywords: 'electrical electronics circuit power energy instrument fit lab',
  t: {
    transients: {
      title: 'First- and second-order circuits',
      keywords: 'rc rl rlc transient step response natural time constant damping underdamped overdamped switching',
    },
    instruments: {
      title: 'Instrumentation and measurement',
      keywords:
        'resistor color code bridge strain gauge thermocouple rtd pt100 rms decibel oscilloscope adc quantization',
    },
    acpower: {
      title: 'AC power and three-phase systems',
      keywords:
        'complex power real reactive apparent power factor correction capacitor ' +
        'three-phase wye delta pu base transformer regulation',
    },
    energy: {
      title: 'Energy systems and the environment',
      keywords:
        'wind turbine betz weibull rayleigh capacity factor solar sun declination pv emissions co2 lcoe kwh btu',
    },
    opamps: {
      title: 'Op-amp circuits and filters',
      keywords:
        'op-amp summing difference instrumentation integrator differentiator sallen-key butterworth chebyshev filter',
    },
    semis: {
      title: 'Diodes and transistors',
      keywords: 'diode shockley zener regulator rectifier ripple bjt mosfet bias gm small-signal common-emitter',
    },
    powerflow: {
      title: 'Power flow and economic dispatch',
      keywords:
        'load flow newton-raphson gauss-seidel ybus admittance dc power flow ' +
        'economic dispatch lambda generator cost grid',
    },
    labfit: {
      title: 'Lab data fitting and uncertainty',
      keywords:
        'least squares regression fit line chi-square residuals uncertainty error bars exponential power levenberg',
    },
    netlist: {
      title: 'Circuit simulator',
      keywords:
        'spice netlist circuit simulator nodal mna ac sweep bode transient ' +
        'thevenin norton op-amp rlc phasor impedance',
    },
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitElectrical.ts. */
export const kitElectrical = kitElectricalStart as unknown as typeof all;
