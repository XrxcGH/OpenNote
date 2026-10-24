// The words of the transient tool: fields, choices, results, notes, and worked steps.
export const transient = {
  title: 'Transient conduction and diffusion',
  keywords:
    'transient conduction lumped capacitance biot fourier heisler chart cooling heating ' +
    'semi-infinite solid time constant diffusion',
  field: {
    mode: 'Problem',
    shape: 'Shape',
    size: 'Sphere or cylinder radius, or half the thickness of a wall',
    k: 'Thermal conductivity, k',
    rho: 'Density, ρ',
    cp: 'Specific heat, cp',
    alpha: 'Thermal diffusivity, α (or mass diffusivity)',
    h: 'Heat transfer coefficient, h',
    tInitial: 'Initial temperature, Ti',
    tFluid: 'Fluid temperature, T∞',
    position: 'Position, from the center (0) to the surface (1)',
    time: 'Time, t (optional)',
    target: 'Target temperature (optional, to find the time)',
    surface: 'Condition at the surface',
    depth: 'Depth below the surface, x',
    tSurface: 'Surface temperature, Ts',
    flux: 'Heat flux into the solid, q″',
    tFluidSemi: 'Fluid temperature, T∞',
  },
  option: {
    lumped: 'Lumped capacitance (a uniform temperature)',
    solid: 'Wall, cylinder, or sphere (exact series)',
    semi: 'Semi-infinite solid',
    sphere: 'Sphere',
    cylinder: 'Long cylinder',
    wall: 'Plane wall (heated or cooled on both faces)',
    temperature: 'Surface held at a temperature',
    flux: 'Constant heat flux into the surface',
    convection: 'Surface in a fluid (convection)',
  },
  example: {
    sphere: 'A copper sphere cooling in air',
    steel: 'A steel slab quenched in a bath',
    ground: 'Ground warmed from the surface for a day',
  },
  row: {
    temperature: 'Temperature at that time',
    timeToTarget: 'Time to reach the target',
    biot: 'Biot number, Bi',
    tau: 'Time constant, τ',
    valid: 'Is the lumped model valid',
    lc: 'Characteristic length, V/As',
    center: 'Center temperature',
    surface: 'Surface temperature',
    heatFraction: 'Share of the largest possible heat transfer so far',
    fourier: 'Fourier number, Fo',
    eta: 'Similarity variable, η',
  },
  word: { valid: 'Yes (Bi is 0.1 or less)', invalid: 'No, Bi is above 0.1: use the series solution' },
  note: {
    lumped: 'The solid is taken to be at one temperature at every instant, which is accurate when Bi is 0.1 or less.',
    solid:
      'A solid with constant properties, an initial uniform temperature, and a sudden change to ' +
      'convection at the surface.',
    semi: 'The solid is deep enough that its far end stays at the initial temperature during the time you give.',
    fhTransWarnBiot:
      'The Biot number is above 0.1, so the temperature is not uniform and the lumped model is not accurate.',
    fhTransWarnEarly:
      'The Fourier number is very small, so the series needs many terms and the result is less certain.',
    fhTransWarnOneTerm: 'The one-term approximation is only accurate for a Fourier number above 0.2.',
  },
  plot: { position: 'Position (0 center, 1 surface)', temperature: 'Temperature', profile: 'Temperature profile' },
  picture: 'The temperature profile from the center to the surface at that time',
} as const;

export const transientStep = {
  fhTransBiot: 'The Biot number is Bi = {Bi}.',
  fhTransTau: 'The time constant is τ = {tau} s.',
  fhTransLumpedT: 'After that time the temperature is T = {T} K.',
  fhTransLumpedTime: 'The solid reaches the target after t = {t} s.',
  fhTransEigen: 'The first eigenvalue is ζ1 = {z1} and the first coefficient is C1 = {c1}.',
  fhTransSeries: 'The series, summed over {n} terms, gives the dimensionless temperature θ = {th}.',
  fhTransHeat: 'The share of the largest possible heat transfer is Q/Q0 = {q}.',
  fhTransDimensionless: 'The Biot number is {Bi} and the Fourier number is {Fo}.',
  fhTransEta: 'The similarity variable is η = {eta}.',
  fhTransSemiT: 'The temperature at that depth is T = {T} K.',
  fhTransSemiQ: 'With constant heat flux the temperature at that depth is T = {T} K.',
  fhTransSemiH: 'With surface convection the temperature at that depth is T = {T} K.',
} as const;
