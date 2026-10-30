// Aircraft dynamic modes: the tool's labels, results, plots, and worked steps (kitAero.t.flightmodes).
export const flightmodes = {
  title: 'Aircraft dynamic modes',
  short: 'Dynamic modes',
  keywords:
    'aircraft dynamic stability modes short period phugoid dutch roll spiral roll subsidence eigenvalues state ' +
    'matrix stability derivatives damping ratio natural frequency',
  about: 'The short period, phugoid, Dutch roll, roll, and spiral modes from a state matrix or stability derivatives.',
  assume:
    'Small disturbances about steady, wings-level flight, so the equations are linear: ẋ = Ax. Longitudinal ' +
    'state [u, w, q, θ]; lateral-directional state [v, p, r, φ]. Body axes, SI units, angles in radians in the ' +
    'matrix. From derivatives, Zq and Zẇ are neglected and Mẇ is folded in. Modes are named by size: the ' +
    'faster longitudinal pair is the short period.',
  f: {
    axis: 'Motion',
    source: 'Build the matrix from',
    A: 'State matrix A (rows between semicolons)',
    Alat: 'State matrix A (rows between semicolons)',
    Xu: 'Xu, per second',
    Xw: 'Xw, per second',
    Zu: 'Zu, per second',
    Zw: 'Zw, per second',
    Mu: 'Mu, per meter-second',
    Mw: 'Mw, per meter-second',
    Mq: 'Mq, per second',
    Mwdot: 'Mẇ, per meter',
    U0: 'Trim speed U₀',
    theta0: 'Trim pitch attitude θ₀',
  },
  h: {
    A: 'Four rows of four numbers for the state [u, w, q, θ].',
    Alat: 'Four rows of four numbers for the state [v, p, r, φ].',
  },
  o: {
    longitudinal: 'Longitudinal',
    lateral: 'Lateral-directional',
    matrix: 'A matrix I type',
    derivatives: 'Dimensional stability derivatives',
  },
  r: {
    root: '{mode}: roots',
    wn: '{mode}: natural frequency ωn',
    zeta: '{mode}: damping ratio ζ',
    tau: '{mode}: time constant',
    period: '{mode}: period',
    half: '{mode}: time to half amplitude',
    double: '{mode}: time to double amplitude',
    approx: '{mode}: two-state approximation',
  },
  p: {
    sPlane: 'Roots in the s-plane',
    re: 'Real part, 1/s',
    im: 'Imaginary part, rad/s',
    roots: 'Roots',
    approx: 'Two-state approximations',
    shortPeriod: 'Short period',
    phugoid: 'Phugoid',
    shortPeriodOverdamped: 'Short period (overdamped)',
    phugoidOverdamped: 'Phugoid (overdamped)',
    dutchRoll: 'Dutch roll',
    roll: 'Roll',
    spiral: 'Spiral',
    oscillation: 'Oscillation',
    real: 'Real root',
  },
  n: {
    stable: 'Every mode is stable: all the roots lie in the left half of the s-plane.',
    unstable: 'At least one mode is unstable: a root lies in the right half of the s-plane.',
  },
  s: {
    fmMatrix: 'State matrix of the linearized equations ẋ = Ax, with state {state}.',
    fmCharacteristic: 'Characteristic equation, from the Faddeev-LeVerrier recursion.',
    fmPair:
      '{mode}: an oscillatory pair with ωn = {wn} rad/s and ζ = {zeta}; the amplitude halves (or doubles) in ' +
      '{time} s.',
    fmReal: '{mode}: a real root; the response halves (or doubles) in {time} s.',
    fmClassifyLong:
      'By frequency, the two fastest roots are the short period and the two slowest the phugoid; either can be ' +
      'an oscillatory pair or, when overdamped, two real roots. The two-state approximations below check each one.',
    fmClassifyLat:
      'The oscillatory pair is the Dutch roll; the fast real root is the roll subsidence and the slow one the ' +
      'spiral mode.',
  },
  e: {
    matrixShape: 'Enter a 4 by 4 matrix: 4 rows of 4 numbers.',
  },
  mode: {
    shortPeriod: 'Short period',
    phugoid: 'Phugoid',
    shortPeriodOverdamped: 'Short period (overdamped)',
    phugoidOverdamped: 'Phugoid (overdamped)',
    dutchRoll: 'Dutch roll',
    roll: 'Roll subsidence',
    spiral: 'Spiral',
    oscillation: 'Oscillatory mode',
    real: 'Real mode',
  },
} as const;
