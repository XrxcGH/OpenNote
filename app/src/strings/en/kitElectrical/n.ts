// Assumptions shown under a result. Part of the kitElectrical namespace.
export const n = {
  idealParts: 'Ideal parts: no source resistance, no wire resistance, and the switch acts at t = 0.',
  seriesStep: 'The source steps from 0 to the level given at t = 0 and stays there.',
  bandsNote:
    'With no tolerance band the tolerance is taken as 20 %. Gold and silver as the third band mean 0.1 and 0.01.',
  seriesNote: 'E-series values are spaced evenly on a logarithmic scale, so the nearest value is found on that scale.',
  tcNote: 'Standard-grade thermocouple, voltage read at the meter, with no error from the wire or meter.',
  rtdNote:
    'IEC 60751 coefficients for a platinum RTD with α = 0.00385; a different alpha needs different coefficients.',
  bridgeNote:
    'Excitation is applied across the bridge. The output is read between the 2 midpoints, with no load on it.',
  strainNote: 'One active gauge is nonlinear; 2 adjacent gauges of opposite strain, or 4 gauges, are linear.',
  sineNote: 'The signal is a pure sine wave. Phase is positive for a lead.',
  adcNote: 'An ideal converter with no offset, gain, or noise error; the code is the bottom of its step.',

  acNote: 'Voltages and currents are rms values. A lagging (inductive) load has positive reactive power.',
  correctionNote: 'The capacitor is placed in parallel with the load, so the real power and the voltage do not change.',
  transformerNote:
    'The series equivalent circuit referred to the low side. The magnetizing branch sits at the supply; its loss is a fixed core loss.',
  threePhaseNote: 'A balanced load with equal impedances, a balanced supply, and line-to-line voltage given.',
  perUnitNote: 'A three-phase base: base impedance is the base line voltage squared over the base power.',

  windNote: 'Steady wind at the speed given, with the air density you give (1.225 kg/m³ at sea level, 15 °C).',
  windStatsNote:
    'Power rises as the cube of speed from cut-in to rated, then stays flat to cut-out. No losses are included.',
  solarNote: 'Cooper’s equation is good to about half a degree. Solar time is used, and refraction is ignored.',
  pvNote: 'A linear loss with cell temperature. Inverter and wiring losses are not included.',
  emissionsNote:
    'Combustion CO₂ only, on a lower-heating-value basis (NIST Chemistry WebBook data). No upstream emissions.',
  lcoeNote: 'One currency, with no inflation or taxes. Capital is spread over the lifetime by the recovery factor.',
  convertNote: 'The BTU is the International Table BTU. A tonne of oil equivalent is 41.868 GJ; a barrel is 6.119 GJ.',

  opampNote: 'An ideal op-amp: infinite gain, no input current, no offset, and an output that can reach any voltage.',
  unmatchedNote: 'The resistor ratios are not matched, so the amplifier also responds to the common-mode level.',
  practicalNote:
    'A real integrator needs a large resistor across the capacitor to stop the output drifting to the supply.',
  skLowNote: 'C1 goes from the middle node to the output; C2 goes from the amplifier input to ground.',
  skHighNote:
    'The 2 capacitors are in series with the signal; R1 goes from the middle node to the output, and R2 to ground.',
  mfbNote:
    'An inverting stage: R1 is the input resistor, R2 goes to the inverting input, R3 is across from the middle node to the output.',
  orderNote: 'Loss is measured against the pass-band gain, and the filter is a low-pass.',
  chebyNote:
    'The Chebyshev response ripples up and down in the passband by the loss you gave, and falls faster after it.',
  rcNote: 'The output is taken across the capacitor with no load.',
  rlcNote: 'The output is taken across the resistor with no load; the source has no resistance.',

  diodeNote: 'An ideal exponential diode with no series resistance of its own and no high-level injection.',
  zenerNote: 'The zener is ideal: a constant voltage Vz once it conducts, with no dynamic resistance.',
  rectifierNote: 'Straight-line discharge of the capacitor, an ideal transformer, and a constant diode drop.',
  bjtNote:
    'An NPN transistor with a constant VBE and a saturation voltage of 0.2 V. The base loads the divider through the Thevenin step.',
  saturatedGainNote:
    'The transistor is saturated, so the small-signal gain shown does not describe a working amplifier.',
  mosNote: 'An n-channel enhancement MOSFET in the square-law model, with the source resistor as the only feedback.',

  pfNote: 'Per unit on the base given. Positive generation, negative load; line charging is split between the 2 ends.',
  gaussNote: 'Gauss-Seidel is slow near the limit of what a network can carry, and a high iteration count is normal.',
  dcNote:
    'Lossless and flat-voltage. Flows are fairly good for lightly loaded lines, and angles are a small-angle estimate.',
  dispatchNote: 'Losses and ramp rates are not included. A unit with a squared term of 0 is a flat-cost unit.',

  lineNote: 'Each point is weighted by 1/σ². The line is an ordinary weighted fit with errors in y only.',
  polyNote: 'Higher degrees always lower χ²; check the residuals and the reduced χ² before trusting a high degree.',
  powerNote: 'The fit is done in the original units, so large values count most unless you give uncertainties.',
  expNote: 'The fit is done in the original units, so large values count most unless you give uncertainties.',
  linearizedNote:
    'The straight-line fit is in the logarithms, so χ² is for them; the residuals plotted are in the original data.',
  customNote: 'A nonlinear fit can end in a local minimum; try different starting values to check.',
  scaledNote: 'No σ was given, so the uncertainties assume every point has the same error, estimated from the scatter.',
  chiNote:
    'A reduced χ² near 1 means the scatter agrees with the uncertainties. Far above 1 means the model or the σ is wrong.',

  netNote: 'Values take SI prefixes: m is milli, u is micro, k is kilo, and M or meg is mega.',
  netDcNote: 'A capacitor is open, an inductor is a short, and a source current is positive into its + terminal.',
  netAcNote: 'Only the AC part of each source is used, in steady state. Phase is plotted without jumps of 360 degrees.',
  netTranNote: 'A switch is 1 mΩ closed and 1 GΩ open. With ic values on capacitors or inductors, t = 0 uses them.',
  netThevNote: 'Dependent sources stay active when the independent sources are set to zero.',
} as const;
