// The words of the pipes tool: fields, choices, results, notes, and worked steps.
export const pipes = {
  title: 'Pipe flow and pumps',
  keywords:
    'pipe flow head loss friction factor moody colebrook darcy reynolds pump curve operating point ' +
    'series parallel network hardy cross minor loss',
  field: {
    mode: 'Problem',
    density: 'Fluid density, ρ',
    viscosity: 'Dynamic viscosity, μ',
    diameter: 'Pipe diameter, D',
    length: 'Pipe length, L',
    roughness: 'Absolute roughness, ε (empty for a smooth pipe)',
    sumK: 'Sum of minor-loss coefficients, ΣK (optional)',
    flowRate: 'Volume flow rate, Q',
    headLossIn: 'Head loss, hL',
    staticHead: 'Static head the pump must lift',
    pumpCurve: 'Points of the pump curve, one per line',
    pipes: 'Pipes, one per line',
    netPipes: 'Pipes of the network, one per line',
    loops: 'Loops, one per line',
  },
  option: {
    headLoss: 'Head loss from the flow rate',
    flow: 'Flow rate from the head loss',
    diameter: 'Pipe diameter for a flow and head loss',
    pump: 'Pump and system curve (operating point)',
    series: 'Pipes in series',
    parallel: 'Pipes in parallel',
    network: 'Pipe network (Hardy Cross)',
  },
  hint: {
    pumpCurve:
      'Each line is the flow rate, then the head the pump gives at that flow, such as 5, 26. Three ' +
      'points fit a parabola exactly; more points fit it by least squares. A bare number is in L/s ' +
      'and m for SI, or gpm and ft for US.',
    pipes:
      'Each line is the diameter, length, roughness, and sum of minor-loss coefficients, such as 50 ' +
      'mm, 100 m, 0.046 mm, 2. A bare number is in mm and m for SI, or in and ft for US.',
    netPipes:
      'Each line is the diameter, length, roughness, minor losses, and an assumed flow rate. The ' +
      'assumed flows must balance at every junction, with the sign giving the direction of the pipe.',
    loops:
      'Each line lists the pipe numbers around one loop. A negative number means the loop runs ' +
      'against that pipe’s direction, such as 1 2 -4 -3.',
  },
  example: {
    steel: 'Water through 100 m of commercial steel pipe',
    flow: 'How much flows for a 10 m head loss',
    size: 'The pipe diameter for a flow and head loss',
    pump: 'A pump lifting water through a pipe',
    series: 'Two pipes in series',
    parallel: 'Two pipes in parallel',
    network: 'A ring of four pipes',
  },
  row: {
    headLoss: 'Head loss, hL',
    pressureDrop: 'Pressure drop, Δp',
    flow: 'Volume flow rate, Q',
    velocity: 'Average speed, V',
    reynolds: 'Reynolds number, Re',
    regime: 'Flow regime',
    friction: 'Darcy friction factor, f',
    frictionHead: 'Head lost to friction',
    minorHead: 'Head lost to fittings',
    powerLoss: 'Power lost to the pipe',
    diameter: 'Pipe diameter, D',
    head: 'Head at the operating point, H',
    hydraulicPower: 'Hydraulic power of the pump',
    iterations: 'Corrections needed',
    loopResidual: 'Largest remaining head imbalance in a loop',
  },
  word: { laminar: 'Laminar', transitional: 'Transitional', turbulent: 'Turbulent' },
  table: { parts: 'Pipes in series', branches: 'Flow in each branch', pipes: 'Flow in each pipe' },
  col: {
    pipe: 'Pipe',
    velocity: 'Speed',
    reynolds: 'Reynolds number',
    friction: 'Friction factor',
    headLoss: 'Head loss',
    flow: 'Flow rate',
    share: 'Share of the total',
  },
  note: {
    darcy: 'Darcy-Weisbach head loss for a full, steady, incompressible pipe flow, with minor losses added as K V²/2g.',
    colebrook:
      'The turbulent friction factor is the Colebrook equation solved exactly. Between Re 2300 and ' +
      '4000 the flow is transitional and the result is uncertain.',
    transitional:
      'The Reynolds number is between 2300 and 4000, where the flow switches between laminar and turbulent and ' +
      'the friction factor is uncertain. Treat the result as an estimate.',
    pumpFit:
      'The pump curve is a parabola through your points; the system curve is the static head plus the ' +
      'pipe’s head loss.',
    series: 'The same flow passes through every pipe, and the head losses add.',
    parallel: 'Every branch has the same head loss, and the flows add up to the total.',
    network: 'The Hardy Cross method corrects the loop flows until the head losses around each loop add up to zero.',
  },
  plot: {
    flow: 'Flow rate',
    head: 'Head',
    pump: 'Pump curve',
    system: 'System curve',
    operating: 'Operating point',
  },
  picture: 'The pump curve and the system curve, crossing at the operating point',
} as const;

export const pipesStep = {
  fhPipesNoFlow: 'With no flow there is no friction and no head loss.',
  fhPipesVelocity: 'The average speed is the flow rate over the cross-section: V = {V} m/s.',
  fhPipesReynolds: 'The Reynolds number is Re = {Re}, so the flow is {regime}.',
  fhPipesFrictionLaminar: 'For laminar flow the friction factor is f = {f}.',
  fhPipesFrictionTurbulent:
    'The Colebrook equation, solved exactly, gives f = {f} (the Haaland formula gives {h} and Swamee-Jain {s}).',
  fhPipesHeadLoss: 'Friction and fittings together lose hL = {hl} m of head.',
  fhPipesPressureDrop: 'The pressure drop is Δp = {dp} Pa.',
  fhPipesSolveFlow: 'Search for the flow rate that gives this head loss: Q = {Q} m³/s.',
  fhPipesSolveDiameter: 'Search for the diameter that gives this head loss at this flow: D = {D} m.',
  fhPipesOperating: 'The pump and system curves cross at Q = {Q} m³/s and H = {H} m.',
  fhPipesPumpFit:
    'Fit the pump curve H = c0 + c1 Q + c2 Q²: c0 = {c0} m, c1 = {c1} s/m², c2 = {c2} s²/m⁵ (SI, with the flow in m³/s).',
  fhPipesPart: 'Pipe {n} loses {hl} m of head.',
  fhPipesSplit: 'The branches share one head loss, hL = {hl} m, and their flows add up to the total.',
  fhPipesCross: 'The loop corrections settled after {n} passes.',
} as const;
