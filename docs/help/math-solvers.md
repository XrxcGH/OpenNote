# Math solvers

Work calculus, engineering, and statistics problems step by step, check the answer, and put the working into your notes.

## Open the solvers

- Open Insert, then Math solvers. Or press Ctrl+Alt+Shift+M.
- Or open the command palette and type what you want, such as "Solve a double or triple integral" or "Find a root with Newton's method". That opens the window on that solver.
- Choose a tab at the top: Integrals, Equations, Transforms, Series, Roots, Errors and units, Probability, Matrices, or Projectile. With the keyboard, the arrow keys move between tabs.
- Choose "Open in its own window" in the title bar to keep the solvers beside a page.

Each solver works the problem as you type. The answer is in the box under the inputs, with a graph and the worked steps below it. Choose **Insert steps into page** to add the steps where the cursor is, or **Graph in page** to add the function as a graph you can edit.

Type math the way the calculator takes it: `x^2`, `sin(x)`, `exp(-2*t)`, `sqrt(x)`, `pi`. Put `*` between letters, as in `x*y`. You can type `θ`, `φ`, and `ρ` or spell them `theta`, `phi`, and `rho`.

Every answer worked by hand is also found numerically, and the steps show the hand answer only when the two agree. When there is no rule for a step, the solver says so and finishes numerically.

## Integrals

1. Choose a region: a rectangle, a region between two curves, a disk, a box, a cylinder, a ball, or a cone. Or choose "Your own limits" and type the limits, innermost first.
2. Choose the coordinates: rectangular, polar, cylindrical, or spherical. A region offers the ones that suit it.
3. Type the integrand. Use 1 for an area or a volume. You can type it in x, y, and z even in polar or spherical coordinates; the solver changes the variables and multiplies by the Jacobian.

The limits of an inner integral may use the variables of the integrals outside it, such as y from 0 to x. The region, or its shadow on the xy-plane, is drawn.

## Differential equations

- **Separable**: type dy/dx, such as `x*y` or `-0.5*(y - 20)`.
- **First-order linear**: type P(x) and Q(x) for y′ + P(x)·y = Q(x).
- **Second-order linear**: type the numbers a, b, and c for a·y″ + b·y′ + c·y = g(x), and g(x), which can be 0 or a sum of polynomials, exponentials, sines, and cosines.

Give the starting point x₀ and y(x₀) (and y′(x₀) for second order), and the range to draw. The graph shows the solution through that point over the slope field. A second-order equation also gets a phase plane: y′ against y.

## Transforms

Choose the Laplace transform, its inverse, the Fourier transform, or its inverse, and type the function.

- The Laplace transform takes sums of products of tⁿ, e^(at), sin, cos, sinh, and cosh.
- The inverse Laplace transform takes a fraction of polynomials in s, and a factor such as `exp(-2*s)` for a delay.
- The Fourier transform uses F(ω) = ∫ f(t)·e^(−iωt) dt and matches functions to the pairs in its table, such as e^(−a|t|) and e^(−at²). Type ω as `w` if you like.

Below the answer are the tables of transform pairs and properties. Type in the search box to find one, such as `sin` or `delay`.

## Series

Type f(x), the center a (0 for a Maclaurin series), and the order n. The steps show each derivative and its value at the center. To bound the error, type a value of x in "Bound the error at x =": you get the Lagrange bound and the actual error there. The graph shows f with each Taylor polynomial.

## Roots

Type f(x), choose Newton's method, bisection, or the secant method, and give a starting guess (or two guesses, or the two ends of an interval where f changes sign for bisection). The table lists each step. The result says whether the method converged, and how fast, or why it stopped: the guesses ran away, the tangent was flat, the guesses went round in a cycle, or f had the same sign at both ends.

## Errors and units

- **Error propagation**: type the formula, then each measured value and its uncertainty. You get the result with its uncertainty, rounded to two significant figures, and how much of the uncertainty comes from each measurement. The measurements are taken to be independent.
- **Unit consistency**: type an equation and the unit of each letter, such as `m/s^2` or `N`. The solver gives each side in SI base units and lists every place the units cannot work, such as adding meters to seconds or taking the sine of a length. Choose a problem in the list to underline where it is. In this checker C is the coulomb and F the farad; write K for temperature.

## Probability

Choose a normal, binomial, or Student t distribution, its parameters, and the area: below a value, above one, between two values, or outside them. The probability is shown with the area shaded, or the bars shaded for the binomial. Type a confidence level, such as 0.95, for the two-sided critical value.

For linear regression, type one point per line, such as `2, 3.9`. You get the least-squares line, R², and the working.

## Matrices

Choose 2 × 2 or 3 × 3 and type the entries. You get the characteristic polynomial, the eigenvalues, the eigenvectors, and whether the matrix can be diagonalized. The picture shows the grid and the unit square (or the unit cube, seen at an angle) before and after the matrix, with the eigenvector lines.

## Projectile

Type the launch speed, angle, and height, and gravity if it is not 9.81 m/s². Turn on air resistance and give the mass, drag coefficient, diameter, and air density to add quadratic drag. You get the range, the highest point, the time in the air, and the landing speed and angle. Choose **Play the flight** to watch it; if you have asked Windows for less motion, it shows the end of the flight instead.
