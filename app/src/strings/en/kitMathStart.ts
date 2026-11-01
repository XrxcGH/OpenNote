// The Math kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitMath.ts joins this object when the kit's code loads (features/tools/mathkit/text.ts).
import type { kitMath as all } from './kitMath';

export const kitMathStart = {
  series: {
    title: 'Series and convergence',
    keywords:
      'series convergence ratio test root test integral test comparison alternating power series radius interval',
  },
  complex: {
    title: 'Complex analysis',
    keywords:
      'complex numbers polar roots logarithm residue pole contour integral laurent conformal map joukowski mobius',
  },
  odes: {
    title: 'Systems of ODEs',
    keywords:
      'differential equations system phase portrait eigenvalue stability node ' +
      'saddle spiral center nullcline equilibrium',
  },
  fourier: {
    title: 'Fourier series and boundary value problems',
    keywords:
      'fourier series half range gibbs parseval heat wave laplace equation separation of variables boundary value',
  },
  numerics: {
    title: 'Numerical methods',
    keywords:
      'numerical methods interpolation spline lagrange newton divided ' +
      'differences richardson simpson trapezoid romberg gauss euler runge ' +
      'kutta jacobi gauss-seidel sor laplace poisson heat finite difference ' +
      'least squares curve fit fft dft',
  },
  console: {
    title: 'Matrix console',
    keywords:
      'matlab octave matrix console command window script matrices eig inv ' +
      'det backslash linspace plot for while if programming',
  },
  linalg: {
    title: 'Linear algebra workbench',
    keywords:
      'linear algebra matrix gaussian elimination gauss jordan rref inverse ' +
      'determinant cofactor rank null space column space lu qr gram schmidt ' +
      'eigenvalue eigenvector diagonalization projection least squares svd ' +
      'singular value change of basis',
  },
  vectorcalc: {
    title: 'Vector calculus and optimization',
    keywords:
      'vector calculus multivariable gradient divergence curl line integral ' +
      'surface integral flux green stokes divergence theorem jacobian ' +
      'lagrange multipliers critical points hessian saddle conservative ' +
      'potential directional derivative tangent plane',
  },
  open: 'Open the engineering mathematics tools',
  keywords: 'mathematics linear algebra calculus series fourier complex differential equations numerical matlab',
  title: 'Engineering mathematics',
  tabs: 'Tools',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitMath.ts. */
export const kitMath = kitMathStart as unknown as typeof all;
