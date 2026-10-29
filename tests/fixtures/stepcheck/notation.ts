// Corpus families for notation as students write it. They cover y' after a formula with a parameter, ÷ between
// fractions, values given on one line, a slash before a product, f(x + h), and rounding to a whole number. They also
// cover vectors as (a, b) and ⟨a, b⟩, unicode fractions, sums to a letter, and steps joined by arrows on one line.
// Called by generate.ts; expected values are worked out here by plain arithmetic.
type Add = (topic: string, lines: string[]) => void;
type AddBroken = (topic: string, lines: string[], at: number) => void;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const frac = (n: number, d: number) => {
  const g = gcd(n, d) * Math.sign(d);
  return d / g === 1 ? `${n / g}` : `${n / g}/${d / g}`;
};

export function notationFamilies(ok: Add, bad: AddBroken): void {
  // y' after a formula in x with parameter letters: d/dx(k x^n) = n k x^(n - 1).
  for (const [p, n] of [
    ['k', 2],
    ['a', 3],
    ['m', 2],
    ['b', 4],
  ] as const) {
    ok('parameters', [`y = ${p}x^${n}`, `y' = ${n}${p}x^${n - 1}`]);
    bad('parameters', [`y = ${p}x^${n}`, `y' = ${n + 1}${p}x^${n - 1}`], 1);
  }
  ok('parameters', ['y = mx + c', "y' = m"]);
  ok('parameters', ['y = ax^2 + bx + c', "y' = 2ax + b"]);
  ok('parameters', ['y = e^(kx)', "y' = k e^(kx)"]);
  ok('parameters', ['s = ut + a t^2/2', "s' = u + a t"]);

  // a/b ÷ c/d = a/b × d/c = (ad)/(bc).
  for (const [a, b, c, d] of [
    [2, 3, 4, 5],
    [1, 2, 1, 4],
    [3, 4, 2, 3],
    [5, 6, 5, 9],
  ]) {
    ok('fraction-division', [`${a}/${b} ÷ ${c}/${d}`, `= ${a}/${b} × ${d}/${c}`, `= ${frac(a * d, b * c)}`]);
    bad('fraction-division', [`${a}/${b} ÷ ${c}/${d}`, `= ${a}/${b} × ${c}/${d}`], 1);
  }
  ok('fraction-division', ['6 ÷ 2/3', '= 9']);
  ok('fraction-division', ['x/2 ÷ x/4', '= 2']);
  ok('fraction-division', ['12 ÷ 3 × 2', '= 8']);

  // Values given together, then an expression worked out with them.
  for (const [x, y] of [
    [2, 3],
    [4, -1],
    [-2, 5],
  ]) {
    ok('given-values', [`x = ${x}, y = ${y}`, 'x + y', `= ${x + y}`]);
    ok('given-values', [`x = ${x} and y = ${y}`, '2x + y', `= ${2 * x + y}`]);
    ok('given-values', [`x = ${x}`, `y = ${y}`, 'x y', `= ${x * y}`]);
    bad('given-values', [`x = ${x}`, `y = ${y}`, 'x + y', `= ${x + y + 1}`], 3);
  }
  ok('given-values', ['2x + 3', '= 7']);

  // A slash before a product, read either way.
  ok('slash', ['1/2x', '= 1/(2x)']);
  ok('slash', ['1/2x', '= x/2']);
  ok('slash', ['2x/3y', '= 2x/(3y)']);

  // f(x + h) after f(x) = x^2: (x + h)^2 = x^2 + 2xh + h^2.
  ok('function-values', ['f(x) = x^2', 'f(x + h) = x^2 + 2xh + h^2']);
  bad('function-values', ['f(x) = x^2', 'f(x + h) = x^2 + h^2'], 1);
  ok('function-values', ['f(x) = 3x + 1', 'f(x + h) = 3x + 3h + 1']);
  bad('function-values', ['f(x) = 3x + 1', 'f(x + h) = 3x + h + 1'], 1);

  // A formula in two letters rearranged for one of them: y - c = kx gives x = (y - c)/k.
  for (const [c, k] of [
    [3, 2],
    [5, 4],
  ]) {
    ok('rearrange', [`y - ${c} = ${k}x`, `x = (y - ${c})/${k}`]);
    bad('rearrange', [`y - ${c} = ${k}x`, `x = y - ${c}/${k}`], 1);
  }

  // Decimal working rounded to a whole number: 9.81 × 2 = 19.62.
  ok('rounding', ['9.81 × 2', '= 20']);
  ok('rounding', ['19.62', '≈ 20']);
  ok('rounding', ['2.5 × 3.1', '= 7.75', '≈ 8']);
  bad('rounding', ['9.81 × 2', '= 30'], 1);
  bad('rounding', ['7/2', '= 3'], 1);

  // Vectors as (a, b, c) and ⟨a, b⟩: (1, 2, 3) · (4, -5, 6) = 4 - 10 + 18 = 12.
  ok('vectors', ['(1, 2, 3) · (4, -5, 6)', '= 12']);
  bad('vectors', ['(1, 2, 3) · (4, -5, 6)', '= 32'], 1);
  ok('vectors', ['(1, 0, 0) × (0, 1, 0)', '= (0, 0, 1)']);
  ok('vectors', ['⟨1,2⟩ + ⟨3,4⟩', '= ⟨4,6⟩']);
  ok('vectors', ['det [[2, 1], [5, 3]]', '= 1']);
  bad('vectors', ['det [[2, 1], [5, 3]]', '= 11'], 1);

  // Unicode fractions: 1/2 + 1/3 = 5/6.
  ok('unicode', ['½ + ⅓', '= ⅚']);
  ok('unicode', ['¾ - ⅝', '= ⅛']);

  // Sums to a letter: 1 + ... + n = n(n + 1)/2, and the squares n(n + 1)(2n + 1)/6.
  ok('sums', ['Σ_(k=1)^(n) k = n(n + 1)/2']);
  ok('sums', ['Σ_(k=1)^(n) k^2 = n(n + 1)(2n + 1)/6']);
  bad('sums', ['Σ_(k=1)^(n) k = n^2/2'], 0);

  // Steps on one line joined by arrows: 2x + 3 = 7, 2x = 4, x = 2.
  ok('arrows', ['2x + 3 = 7 → 2x = 4 → x = 2']);
  ok('arrows', ['3x - 1 = 8 ⇒ 3x = 9 ⇒ x = 3']);
  ok('arrows', ['2x + 3 = 7', '∴ x = 2']);
  bad('arrows', ['2x + 3 = 7', '2x = 4 → x = 3'], 1);
}
