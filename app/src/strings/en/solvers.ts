// The math solvers window (flag math.solvers; owner: the calc-solvers lane): multiple integrals, differential
// equations, transforms, series, roots, uncertainty and units, probability, eigenvalues, and projectiles. Each
// namespace file has one owner, so parallel work never edits the same file.

export const solvers = {
  step: {
    integralSetup: 'Write the integral with its limits, innermost first.',
    integralChange:
      '{system, select, polar {Change to polar coordinates.} cylindrical {Change to cylindrical coordinates.} other {Change to spherical coordinates.}} Multiply by the Jacobian.',
    integralIntegrand: 'The integrand in the new coordinates, with the Jacobian:',
    integralInner: 'Integrate with respect to {variable}, holding the other variables fixed.',
    integralBounds: 'Evaluate at the limits and subtract.',
    integralNoRule: 'No rule finds an antiderivative of this in {variable}, so the rest is found numerically.',
    integralValue: 'The value of the integral:',
    integralNumeric: 'The value of the integral, found numerically:',
    odeSeparable: 'Write dy/dx as a function of x times a function of y.',
    odeSeparate: 'Separate the variables.',
    odeIntegrateBoth: 'Integrate both sides.',
    odeConstant: 'Use y({x0}) = {y0} to find the constant.',
    odeSolution: 'The solution:',
    odeNumericOnly:
      'The steps cannot be finished by hand here, so the solution is found numerically (fourth-order Runge-Kutta) and shown on the graph.',
    odeLinear: 'Write the equation in the form y′ + P(x)·y = Q(x).',
    odeFactor: 'Find the integrating factor.',
    odeMultiply: 'Multiply both sides by it. The left side is now the derivative of a product.',
    odeIntegrateRight: 'Integrate both sides.',
    odeSecond: 'A second-order linear equation with constant coefficients:',
    odeCharacteristic: 'Write the characteristic equation.',
    odeRootRepeated: 'It has one repeated root.',
    odeRootsReal: 'It has two real roots.',
    odeRootsComplex: 'It has two complex roots.',
    odeHomogeneous: 'The solution of the homogeneous equation:',
    odeGuess: 'Guess a particular solution of the same form as the right side (times x where it repeats a root).',
    odeParticular: 'Put the guess into the equation and match coefficients.',
    odeConstants: 'Use y({x0}) = {y0} and y′({x0}) = {v0} to find the constants.',
  },
  error: {
    empty: 'Type an expression first.',
    unreadable: '"{detail}" couldn\'t be read as math. Check the brackets and put * between letters, as in x*y.',
    'unknown-name': '"{detail}" has no value here. Use only the variables this solver lists.',
    'no-derivative': "This expression can't be differentiated with respect to {detail}.",
    'limits-count': 'Give one, two, or three integrals.',
    'limits-variables': 'Each integral needs its own variable, written in letters.',
    'limits-order':
      'The limits of {detail} use a variable that is integrated before it. Put integrals with variable limits inside the ones they depend on.',
    'not-separable': "This can't be written as a function of x times a function of y.",
    'ode-range': 'Check the starting point and the range: the range must run from left to right.',
    'ode-coefficients': "The coefficients a, b, and c must be numbers, and a can't be 0.",
    'ode-forcing':
      'The right side must be a sum of polynomials, exponentials, sines, and cosines, such as 3x^2 + e^(2x) + sin(x).',
    'laplace-term':
      'The term {detail} is not in the table. Terms can be sums of t^n, e^(at), sin(bt), cos(bt), sinh(bt), and cosh(bt) multiplied together.',
    'inverse-form': 'The transform must be a fraction of polynomials in s, times e^(−cs) for a delay.',
    'inverse-improper':
      'The top of the fraction must have a lower degree than the bottom. A higher one means impulses, which this solver leaves out.',
    'fourier-term': 'The term {detail} does not match a pair in the table, so the transform is not shown.',
    'series-order': 'The order must be a whole number from 1 to 20.',
    'series-undefined': 'f or one of its derivatives is not defined at {detail}. Choose another center.',
    'error-values': 'Give {detail} a number and an uncertainty of 0 or more.',
    'error-undefined': 'The expression is not defined at these values.',
    'unit-unknown': '"{detail}" is not a unit this checker knows. Write units such as kg, m/s^2, N, J, W, V, or Ω.',
    'prob-parameters':
      'Check the parameters: σ and the degrees of freedom must be above 0, n a whole number up to 10,000, and p from 0 to 1.',
    'prob-region': 'The left end must be at or below the right end.',
    'regression-points': 'Give at least two points with different x values.',
    'matrix-size': 'Fill in every entry of a 2×2 or 3×3 matrix with a number.',
    'projectile-input':
      'Check the launch: speed above 0, an angle between −90° and 90° (above 0 from the ground), and a height, gravity, and drag of 0 or more.',
    unknown: "This couldn't be worked out. Check the input.",
  },
} as const;
