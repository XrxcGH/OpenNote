// Builds corpus.json: worked solutions for Check my work. Some are correct; the rest have one broken step. Each family
// writes a solution the way a student would, from parameters, with the expected values worked out here by plain
// arithmetic (not by the checker). A broken solution has its slip at `broken` and carries on correctly from it, as a
// student would. Run: node tests/fixtures/stepcheck/generate.ts (the JSON is committed; the test reads it).
import { writeFileSync } from 'node:fs';
import { answerFamilies } from './answers.ts';
import { notationFamilies } from './notation.ts';

interface Case {
  id: string;
  topic: string;
  lines: string[];
  /** The index of the first broken line, for the broken solutions. */
  broken?: number;
}

const correct: Case[] = [];
const broken: Case[] = [];
const ok = (topic: string, lines: string[]) => correct.push({ id: `${topic}-${correct.length + 1}`, topic, lines });
const bad = (topic: string, lines: string[], at: number) =>
  broken.push({ id: `${topic}-b${broken.length + 1}`, topic, lines, broken: at });

/** A number as a student writes it: whole, or a fraction a/b in lowest terms. */
function frac(n: number, d = 1): string {
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(Math.abs(n), Math.abs(d));
  const [p, q] = [n / g, d / g];
  return q === 1 ? String(p) : `${p}/${q}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a || 1 : gcd(b, a % b);
}
/** A signed term: + 3 or - 3. */
const sg = (n: number) => (n < 0 ? `- ${-n}` : `+ ${n}`);
/** A coefficient before x: 1 is dropped, -1 is a minus sign. */
const co = (n: number, v = 'x') => (n === 1 ? v : n === -1 ? `-${v}` : `${n}${v}`);

// Algebra: `a x + b = c` ------------------------------------------------------------------------------------------------
for (const [a, b, c] of [
  [2, 3, 11],
  [3, -4, 8],
  [5, 7, -8],
  [4, 1, 21],
  [7, -2, 12],
  [6, 5, 5],
  [9, 4, -14],
  [2, -9, 3],
]) {
  ok('linear', [`${co(a)} ${sg(b)} = ${c}`, `${co(a)} = ${c - b}`, `x = ${frac(c - b, a)}`]);
  bad('linear', [`${co(a)} ${sg(b)} = ${c}`, `${co(a)} = ${c + b}`, `x = ${frac(c + b, a)}`], 1);
  if (c !== b) bad('linear', [`${co(a)} ${sg(b)} = ${c}`, `${co(a)} = ${c - b}`, `x = ${frac((c - b) * a, 1)}`], 2);
}

// Algebra: `a x + b = c x + d` ------------------------------------------------------------------------------------------
for (const [a, b, c, d] of [
  [5, 3, 2, 12],
  [7, -1, 3, 11],
  [4, 9, -2, -3],
  [6, 2, 1, 22],
  [3, -8, 5, 4],
  [8, 1, 3, 26],
]) {
  ok('linear2', [
    `${co(a)} ${sg(b)} = ${co(c)} ${sg(d)}`,
    `${co(a - c)} ${sg(b)} = ${d}`,
    `${co(a - c)} = ${d - b}`,
    `x = ${frac(d - b, a - c)}`,
  ]);
  bad(
    'linear2',
    [
      `${co(a)} ${sg(b)} = ${co(c)} ${sg(d)}`,
      `${co(a + c)} ${sg(b)} = ${d}`,
      `${co(a + c)} = ${d - b}`,
      `x = ${frac(d - b, a + c)}`,
    ],
    1,
  );
}

// Algebra: brackets a(x + b) - c = d ---------------------------------------------------------------------------------
for (const [a, b, c, d] of [
  [3, 2, 4, 11],
  [2, -5, 1, 7],
  [4, 3, -2, 30],
  [5, 1, 6, 9],
  [6, -2, 3, 15],
]) {
  ok('brackets', [
    `${a}(x ${sg(b)}) ${sg(-c)} = ${d}`,
    `${co(a)} ${sg(a * b)} ${sg(-c)} = ${d}`,
    `${co(a)} = ${d + c - a * b}`,
    `x = ${frac(d + c - a * b, a)}`,
  ]);
  bad(
    'brackets',
    [
      `${a}(x ${sg(b)}) ${sg(-c)} = ${d}`,
      `${co(a)} ${sg(b)} ${sg(-c)} = ${d}`,
      `${co(a)} = ${d + c - b}`,
      `x = ${frac(d + c - b, a)}`,
    ],
    1,
  );
}

// Algebra: factoring x^2 + (p + q) x + p q = 0 -----------------------------------------------------------------------
for (const [p, q] of [
  [2, 3],
  [-1, 4],
  [5, -2],
  [-3, -4],
  [1, 6],
  [-6, 2],
  [7, 1],
]) {
  const quad = `x^2 ${sg(p + q)}x ${sg(p * q)} = 0`;
  ok('factor', [quad, `(x ${sg(p)})(x ${sg(q)}) = 0`, `x = ${-p} or x = ${-q}`]);
  bad('factor', [quad, `(x ${sg(-p)})(x ${sg(q)}) = 0`, `x = ${p} or x = ${-q}`], 1);
  bad('factor', [quad, `(x ${sg(p)})(x ${sg(q)}) = 0`, `x = ${p} or x = ${q}`], 2);
}

// Algebra: expanding (x + a)^2 and (x + a)(x + b) --------------------------------------------------------------------
for (const a of [1, 2, 3, -4, 5, -6, 7]) {
  ok('expand', [`(x ${sg(a)})^2`, `= (x ${sg(a)})(x ${sg(a)})`, `= x^2 ${sg(2 * a)}x ${sg(a * a)}`]);
  bad('expand', [`(x ${sg(a)})^2`, `= x^2 ${sg(a * a)}`], 1);
}
for (const [a, b] of [
  [2, 5],
  [-3, 4],
  [6, -1],
  [-2, -7],
  [3, 3],
]) {
  ok('expand', [
    `(x ${sg(a)})(x ${sg(b)})`,
    `= x^2 ${sg(b)}x ${sg(a)}x ${sg(a * b)}`,
    `= x^2 ${sg(a + b)}x ${sg(a * b)}`,
  ]);
  bad(
    'expand',
    [`(x ${sg(a)})(x ${sg(b)})`, `= x^2 ${sg(b)}x ${sg(a)}x ${sg(a * b)}`, `= x^2 ${sg(a * b)}x ${sg(a + b)}`],
    2,
  );
}

// Algebra: rational expressions and powers ---------------------------------------------------------------------------
for (const a of [2, 3, 5, 7]) {
  ok('rational', [`(x^2 - ${a * a})/(x - ${a})`, `= (x - ${a})(x + ${a})/(x - ${a})`, `= x + ${a}`]);
  bad('rational', [`(x^2 - ${a * a})/(x - ${a})`, `= (x - ${a})(x + ${a})/(x - ${a})`, `= x - ${a}`], 2);
}
for (const [m, n] of [
  [2, 3],
  [4, 5],
  [3, 7],
]) {
  ok('powers', [`x^${m} * x^${n}`, `= x^${m + n}`]);
  bad('powers', [`x^${m} * x^${n}`, `= x^${m * n}`], 1);
  ok('powers', [`(x^${m})^${n}`, `= x^${m * n}`]);
}
for (const [a, b] of [
  [1, 2],
  [2, 3],
  [3, 5],
]) {
  // x/a + x/b = 1, so (a + b) x = a b.
  ok('fractions', [
    `x/${a} + x/${b} = 1`,
    `${b}x + ${a}x = ${a * b}`,
    `${a + b}x = ${a * b}`,
    `x = ${frac(a * b, a + b)}`,
  ]);
  bad('fractions', [`x/${a} + x/${b} = 1`, `${b}x + ${a}x = 1`, `${a + b}x = 1`, `x = ${frac(1, a + b)}`], 1);
}

// Quadratic formula --------------------------------------------------------------------------------------------------
for (const [b, c] of [
  [-5, 6],
  [2, -8],
  [-1, -12],
  [6, 5],
]) {
  const disc = b * b - 4 * c;
  const r = Math.sqrt(disc);
  ok('quadratic', [
    `x^2 ${sg(b)}x ${sg(c)} = 0`,
    `x = (${-b} ± sqrt(${disc}))/2`,
    `x = ${frac(-b + r, 2)} or x = ${frac(-b - r, 2)}`,
  ]);
  bad(
    'quadratic',
    [`x^2 ${sg(b)}x ${sg(c)} = 0`, `x = (${b} ± sqrt(${disc}))/2`, `x = ${frac(b + r, 2)} or x = ${frac(b - r, 2)}`],
    1,
  );
}

// Trigonometry -------------------------------------------------------------------------------------------------------
ok('trig', ['(1 - cos(x)^2)/sin(x)', '= sin(x)^2/sin(x)', '= sin(x)']);
bad('trig', ['(1 - cos(x)^2)/sin(x)', '= sin(x)^2/sin(x)', '= cos(x)'], 2);
ok('trig', ['sin(2x)/(2cos(x))', '= 2 sin(x) cos(x)/(2 cos(x))', '= sin(x)']);
bad('trig', ['sin(2x)/(2cos(x))', '= sin(x) cos(x)/(2 cos(x))', '= sin(x)/2'], 1);
ok('trig', ['tan(x) cos(x)', '= sin(x)/cos(x) * cos(x)', '= sin(x)']);
bad('trig', ['tan(x) cos(x)', '= cos(x)/sin(x) * cos(x)', '= cos(x)^2/sin(x)'], 1);
ok('trig', ['cos(2x) + 2 sin(x)^2', '= 1 - 2 sin(x)^2 + 2 sin(x)^2', '= 1']);
bad('trig', ['cos(2x) + 2 sin(x)^2', '= 1 - sin(x)^2 + 2 sin(x)^2', '= 1 + sin(x)^2'], 1);
ok('trig', [
  'sin(x)^4 - cos(x)^4',
  '= (sin(x)^2 - cos(x)^2)(sin(x)^2 + cos(x)^2)',
  '= sin(x)^2 - cos(x)^2',
  '= -cos(2x)',
]);
bad(
  'trig',
  ['sin(x)^4 - cos(x)^4', '= (sin(x)^2 - cos(x)^2)(sin(x)^2 + cos(x)^2)', '= sin(x)^2 - cos(x)^2', '= cos(2x)'],
  3,
);
ok('trig', ['1 + tan(x)^2', '= 1 + sin(x)^2/cos(x)^2', '= (cos(x)^2 + sin(x)^2)/cos(x)^2', '= 1/cos(x)^2']);
bad('trig', ['1 + tan(x)^2', '= 1 + sin(x)^2/cos(x)^2', '= (cos(x)^2 + sin(x)^2)/cos(x)^2', '= 1/sin(x)^2'], 3);
ok('trig', ['sin(x + pi/2)', '= sin(x) cos(pi/2) + cos(x) sin(pi/2)', '= cos(x)']);
bad('trig', ['sin(x + pi/2)', '= sin(x) cos(pi/2) - cos(x) sin(pi/2)', '= -cos(x)'], 1);
for (const k of [2, 3, 4, 5]) {
  ok('trig', [`2 sin(${k}x) cos(${k}x)`, `= sin(${2 * k}x)`]);
  bad('trig', [`2 sin(${k}x) cos(${k}x)`, `= sin(${k}x)`], 1);
  ok('trig', [`cos(${k}x)^2 - sin(${k}x)^2`, `= cos(${2 * k}x)`]);
}
ok('trig', ['sin(x)^2 + cos(x)^2 = 1']);
ok('trig', ['2 sin(x) = 1', 'sin(x) = 1/2']);
bad('trig', ['2 sin(x) = 1', 'sin(x) = 2'], 1);

// Exponentials and logarithms ----------------------------------------------------------------------------------------
for (const [a, k, b] of [
  [3, 2, 12],
  [2, 5, 14],
  [4, 3, 20],
  [5, 1, 35],
]) {
  ok('exp', [
    `${a} e^(${k}x) = ${b}`,
    `e^(${k}x) = ${frac(b, a)}`,
    `${k}x = ln(${frac(b, a)})`,
    `x = ln(${frac(b, a)})/${k}`,
  ]);
  bad('exp', [`${a} e^(${k}x) = ${b}`, `e^(${k}x) = ${b - a}`, `${k}x = ln(${b - a})`, `x = ln(${b - a})/${k}`], 1);
}
for (const [base, n] of [
  [2, 4],
  [3, 3],
  [5, 2],
  [2, 6],
]) {
  const p = base ** n;
  ok('exp', [`${base}^(x + 1) = ${p}`, `x + 1 = ${n}`, `x = ${n - 1}`]);
  bad('exp', [`${base}^(x + 1) = ${p}`, `x + 1 = ${p / base}`, `x = ${p / base - 1}`], 1);
}
for (const a of [2, 3, 7]) {
  ok('logs', [`ln(${a}x) - ln(${a})`, `= ln(${a}x/${a})`, '= ln(x)']);
  bad('logs', [`ln(${a}x) - ln(${a})`, `= ln(${a}x - ${a})`], 1);
  ok('logs', [`ln(x^${a})`, `= ${a} ln(x)`]);
  bad('logs', [`ln(x^${a})`, `= ln(x)^${a}`], 1);
}
ok('logs', ['ln(x) + ln(x + 1)', '= ln(x(x + 1))', '= ln(x^2 + x)']);
bad('logs', ['ln(x) + ln(x + 1)', '= ln(x + x + 1)', '= ln(2x + 1)'], 1);
ok('logs', ['log(1000)', '= 3']);
bad('logs', ['log(1000)', '= 4'], 1);
ok('logs', ['e^(ln(5) + ln(2))', '= e^(ln(10))', '= 10']);
bad('logs', ['e^(ln(5) + ln(2))', '= e^(ln(7))', '= 7'], 1);

// Derivatives --------------------------------------------------------------------------------------------------------
for (const [a, n] of [
  [3, 4],
  [5, 2],
  [2, 7],
  [-4, 3],
  [6, 5],
]) {
  ok('derivative', [`d/dx(${a}x^${n}) = ${a * n}x^${n - 1}`]);
  bad('derivative', [`d/dx(${a}x^${n}) = ${a}x^${n - 1}`], 0);
}
for (const n of [2, 3, 4]) {
  ok('derivative', [`d/dx(x^${n} sin(x))`, `= ${n}x^${n - 1} sin(x) + x^${n} cos(x)`]);
  bad('derivative', [`d/dx(x^${n} sin(x))`, `= ${n}x^${n - 1} cos(x)`], 1);
}
for (const a of [2, 3, 5]) {
  ok('derivative', [`d/dx(sin(${a}x^2)) = ${2 * a}x cos(${a}x^2)`]);
  bad('derivative', [`d/dx(sin(${a}x^2)) = cos(${a}x^2)`], 0);
  ok('derivative', [`d/dx(x/(x + ${a}))`, `= ((x + ${a}) - x)/(x + ${a})^2`, `= ${a}/(x + ${a})^2`]);
  bad('derivative', [`d/dx(x/(x + ${a}))`, `= (x - (x + ${a}))/(x + ${a})^2`, `= -${a}/(x + ${a})^2`], 1);
  ok('derivative', [`d/dx(ln(${a}x + 1)) = ${a}/(${a}x + 1)`]);
  bad('derivative', [`d/dx(ln(${a}x + 1)) = 1/(${a}x + 1)`], 0);
}
for (const k of [2, 3, -1]) {
  ok('derivative', [`f(x) = x e^(${k}x)`, `f'(x) = e^(${k}x) + ${k}x e^(${k}x)`]);
  bad('derivative', [`f(x) = x e^(${k}x)`, `f'(x) = ${k} e^(${k}x)`], 1);
}
ok('derivative', ['f(x) = x^3 - 2x', "f'(x) = 3x^2 - 2", "f'(2) = 10"]);
bad('derivative', ['f(x) = x^3 - 2x', "f'(x) = 3x^2 - 2", "f'(2) = 12"], 2);
ok('derivative', ['d/dx(e^x cos(x)) = e^x cos(x) - e^x sin(x)']);
bad('derivative', ['d/dx(e^x cos(x)) = e^x cos(x) + e^x sin(x)'], 0);
ok('derivative', ['d/dx(sqrt(x^2 + 1)) = x/sqrt(x^2 + 1)']);
bad('derivative', ['d/dx(sqrt(x^2 + 1)) = 1/(2 sqrt(x^2 + 1))'], 0);

// Integrals ----------------------------------------------------------------------------------------------------------
for (const [a, n] of [
  [3, 2],
  [4, 3],
  [5, 4],
  [6, 1],
  [2, 5],
]) {
  ok('integral', [`∫ ${a}x^${n} dx`, `= ${frac(a, n + 1)} x^${n + 1} + C`]);
  bad('integral', [`∫ ${a}x^${n} dx`, `= ${a}x^${n + 1} + C`], 1);
}
for (const k of [2, 3, 4]) {
  ok('byparts', [
    `∫ x e^(${k}x) dx`,
    `= x e^(${k}x)/${k} - ∫ e^(${k}x)/${k} dx`,
    `= x e^(${k}x)/${k} - e^(${k}x)/${k * k} + C`,
  ]);
  bad(
    'byparts',
    [`∫ x e^(${k}x) dx`, `= x e^(${k}x)/${k} - ∫ e^(${k}x)/${k} dx`, `= x e^(${k}x)/${k} + e^(${k}x)/${k * k} + C`],
    2,
  );
  bad('byparts', [`∫ x e^(${k}x) dx`, `= x e^(${k}x) - ∫ e^(${k}x) dx`, `= x e^(${k}x) - e^(${k}x) + C`], 1);
}
ok('byparts', [
  '∫ x cos(x) dx',
  'u = x, du = dx, dv = cos(x) dx, v = sin(x)',
  '= x sin(x) - ∫ sin(x) dx',
  '= x sin(x) + cos(x) + C',
]);
bad(
  'byparts',
  [
    '∫ x cos(x) dx',
    'u = x, du = dx, dv = cos(x) dx, v = sin(x)',
    '= x sin(x) - ∫ sin(x) dx',
    '= x sin(x) - cos(x) + C',
  ],
  3,
);
ok('byparts', ['∫ x sin(x) dx', '= -x cos(x) + ∫ cos(x) dx', '= -x cos(x) + sin(x) + C']);
bad('byparts', ['∫ x sin(x) dx', '= x cos(x) - ∫ cos(x) dx', '= x cos(x) - sin(x) + C'], 1);
ok('byparts', ['∫ ln(x) dx', '= x ln(x) - ∫ x * 1/x dx', '= x ln(x) - x + C']);
bad('byparts', ['∫ ln(x) dx', '= x ln(x) - ∫ x * 1/x dx', '= x ln(x) + C'], 2);
for (const [a, n] of [
  [1, 2],
  [3, 3],
  [2, 4],
]) {
  ok('substitution', [
    `∫ 2x (x^2 + ${a})^${n} dx`,
    `let u = x^2 + ${a}`,
    `= ∫ u^${n} du`,
    `= u^${n + 1}/${n + 1} + C`,
    `= (x^2 + ${a})^${n + 1}/${n + 1} + C`,
  ]);
  bad(
    'substitution',
    [
      `∫ 2x (x^2 + ${a})^${n} dx`,
      `let u = x^2 + ${a}`,
      `= ∫ u^${n} du`,
      `= u^${n + 1} + C`,
      `= (x^2 + ${a})^${n + 1} + C`,
    ],
    3,
  );
}
for (const a of [2, 3, 5]) {
  ok('substitution', [
    `∫ cos(${a}x) dx`,
    `let u = ${a}x`,
    `= ∫ cos(u)/${a} du`,
    `= sin(u)/${a} + C`,
    `= sin(${a}x)/${a} + C`,
  ]);
  bad('substitution', [`∫ cos(${a}x) dx`, `let u = ${a}x`, `= ∫ cos(u) du`, `= sin(u) + C`, `= sin(${a}x) + C`], 2);
  ok('substitution', [`∫ ${a} e^(${a}x) dx = e^(${a}x) + C`]);
  bad('substitution', [`∫ ${a} e^(${a}x) dx = ${a * a} e^(${a}x) + C`], 0);
}
ok('substitution', ['∫ 2x cos(x^2) dx', 'let u = x^2', '= ∫ cos(u) du', '= sin(u) + C', '= sin(x^2) + C']);
bad('substitution', ['∫ 2x cos(x^2) dx', 'let u = x^2', '= ∫ cos(u) du', '= -sin(u) + C', '= -sin(x^2) + C'], 3);
for (const [b, n] of [
  [1, 2],
  [2, 3],
  [3, 1],
  [2, 2],
]) {
  const value = frac(b ** (n + 1), n + 1);
  ok('definite', [`∫_0^${b} x^${n} dx = [x^${n + 1}/${n + 1}]_0^${b} = ${value}`]);
  bad('definite', [`∫_0^${b} x^${n} dx = [x^${n + 1}/${n + 1}]_0^${b} = ${frac(b ** (n + 1), n)}`], 0);
}
ok('definite', ['∫_0^pi sin(x) dx', '= [-cos(x)]_0^pi', '= 2']);
bad('definite', ['∫_0^pi sin(x) dx', '= [cos(x)]_0^pi', '= -2'], 1);
ok('definite', ['∫_1^e 1/x dx', '= [ln(x)]_1^e', '= 1']);
bad('definite', ['∫_1^e 1/x dx', '= [ln(x)]_1^e', '= e'], 2);

// Limits and series --------------------------------------------------------------------------------------------------
for (const a of [1, 2, 3, 4]) {
  ok('limit', [`lim_(x->${a}) (x^2 - ${a * a})/(x - ${a})`, `= lim_(x->${a}) (x + ${a})`, `= ${2 * a}`]);
  bad('limit', [`lim_(x->${a}) (x^2 - ${a * a})/(x - ${a})`, `= lim_(x->${a}) (x + ${a})`, `= ${a}`], 2);
}
for (const k of [2, 3, 5]) {
  ok('limit', [`lim_(x->0) sin(${k}x)/x = ${k}`]);
  bad('limit', [`lim_(x->0) sin(${k}x)/x = 1`], 0);
}
for (const [a, b] of [
  [3, 2],
  [5, 4],
  [1, 7],
]) {
  ok('limit', [
    `lim_(x->∞) (${a}x^2 + 1)/(${b}x^2 + x)`,
    `= lim_(x->∞) (${a} + 1/x^2)/(${b} + 1/x)`,
    `= ${frac(a, b)}`,
  ]);
  bad(
    'limit',
    [`lim_(x->∞) (${a}x^2 + 1)/(${b}x^2 + x)`, `= lim_(x->∞) (${a} + 1/x^2)/(${b} + 1/x)`, `= ${frac(b, a)}`],
    2,
  );
}
ok('limit', ['lim_(x->0) (1 - cos(x))/x^2 = 1/2']);
bad('limit', ['lim_(x->0) (1 - cos(x))/x^2 = 0'], 0);
ok('limit', ['lim_(x->0) (e^x - 1)/x', '= lim_(x->0) e^x/1', '= 1']);
bad('limit', ['lim_(x->0) (e^x - 1)/x', '= lim_(x->0) e^x/1', '= 0'], 2);
for (const n of [10, 20, 100]) {
  ok('series', [`Σ_(n=1)^(${n}) n = ${(n * (n + 1)) / 2}`]);
  bad('series', [`Σ_(n=1)^(${n}) n = ${n * n}`], 0);
}
ok('series', ['Σ_(n=0)^(∞) (1/2)^n = 2']);
bad('series', ['Σ_(n=0)^(∞) (1/2)^n = 1'], 0);
ok('series', ['Σ_(n=1)^(5) n^2 = 1 + 4 + 9 + 16 + 25 = 55']);
bad('series', ['Σ_(n=1)^(5) n^2 = 1 + 4 + 9 + 16 + 25 = 45'], 0);

// Linear systems -----------------------------------------------------------------------------------------------------
for (const [x, y] of [
  [3, 2],
  [5, -1],
  [-2, 4],
  [7, 3],
  [1, 2],
  [-3, -5],
]) {
  const [s, d] = [x + y, x - y];
  ok('system', [`x + y = ${s}, x - y = ${d}`, `2x = ${s + d}`, `x = ${x}`, `y = ${y}`]);
  bad('system', [`x + y = ${s}, x - y = ${d}`, `2x = ${s - d}`, `x = ${(s - d) / 2}`, `y = ${s - (s - d) / 2}`], 1);
  bad('system', [`x + y = ${s}, x - y = ${d}`, `2x = ${s + d}`, `x = ${x}`, `y = ${y + 1}`], 3);
}
for (const [x, y, a, b, c, e] of [
  [2, 1, 2, 3, 1, -1],
  [1, 4, 3, 1, 2, 5],
  [-1, 2, 4, -1, 1, 2],
  [3, -2, 1, 2, 3, 1],
]) {
  const [r1, r2] = [a * x + b * y, c * x + e * y];
  // Elimination: multiply to match x, subtract, then solve for y and back for x.
  const [k1, k2] = [c, a];
  const coefY = b * k1 - e * k2;
  const rhs = r1 * k1 - r2 * k2;
  const sys = `${co(a)} ${sg(b)}y = ${r1}, ${co(c)} ${sg(e)}y = ${r2}`;
  ok('system', [
    sys,
    `${co(a * k1)} ${sg(b * k1)}y = ${r1 * k1}, ${co(c * k2)} ${sg(e * k2)}y = ${r2 * k2}`,
    `${co(coefY, 'y')} = ${rhs}`,
    `y = ${y}`,
    `x = ${x}`,
    `x = ${x}, y = ${y}`,
  ]);
  bad(
    'system',
    [
      sys,
      `${co(a * k1)} ${sg(b * k1)}y = ${r1 * k1}, ${co(c * k2)} ${sg(e * k2)}y = ${r2 * k2}`,
      `${co(coefY, 'y')} = ${rhs + 2}`,
      `y = ${frac(rhs + 2, coefY)}`,
    ],
    2,
  );
}

// Matrices and vectors -----------------------------------------------------------------------------------------------
type M = number[][];
const mt = (m: M) => `[${m.map((row) => `[${row.join(', ')}]`).join(', ')}]`;
const mul = (a: M, b: M): M => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
for (const [a, b] of [
  [
    [
      [1, 2],
      [3, 4],
    ],
    [
      [0, 1],
      [1, 0],
    ],
  ],
  [
    [
      [2, 0],
      [1, 3],
    ],
    [
      [1, 4],
      [2, 5],
    ],
  ],
  [
    [
      [1, -1],
      [2, 1],
    ],
    [
      [3, 1],
      [0, 2],
    ],
  ],
  [
    [
      [4, 1],
      [0, -2],
    ],
    [
      [1, 1],
      [1, -1],
    ],
  ],
] as [M, M][]) {
  const p = mul(a, b);
  ok('matrix', [`${mt(a)} * ${mt(b)} = ${mt(p)}`]);
  const off = p.map((row, i) => row.map((v, j) => (i === 1 && j === 0 ? v + 1 : v)));
  bad('matrix', [`${mt(a)} * ${mt(b)} = ${mt(off)}`], 0);
  const [[w, x], [y, z]] = a;
  const det = w * z - x * y;
  ok('matrix', [`det(${mt(a)}) = ${w}*${z} - ${x}*${y} = ${det}`]);
  if (x * y !== 0) bad('matrix', [`det(${mt(a)}) = ${w}*${z} + ${x}*${y} = ${w * z + x * y}`], 0);
  ok('matrix', [`2 * ${mt(a)} - ${mt(b)} = ${mt(a.map((row, i) => row.map((v, j) => 2 * v - b[i][j])))}`]);
}
for (const [a, b, c, d] of [
  [2, 1, 1, 1],
  [3, 1, 5, 2],
  [4, 3, 1, 1],
]) {
  const det = a * d - b * c;
  ok('matrix', [`[[${a}, ${b}], [${c}, ${d}]]^-1`, `= 1/${det} * [[${d}, ${-b}], [${-c}, ${a}]]`]);
  bad('matrix', [`[[${a}, ${b}], [${c}, ${d}]]^-1`, `= 1/${det} * [[${d}, ${b}], [${c}, ${a}]]`], 1);
}
for (const [u, v] of [
  [
    [1, 2, 3],
    [4, 5, 6],
  ],
  [
    [2, -1, 0],
    [3, 3, 1],
  ],
  [
    [1, 0, 2],
    [-2, 4, 1],
  ],
  [
    [3, 1, -2],
    [1, 1, 1],
  ],
]) {
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  ok('vector', [
    `[${u.join(', ')}] · [${v.join(', ')}] = ${u[0]}*${v[0]} + ${u[1]}*${v[1]} + ${u[2]}*${v[2]} = ${dot}`,
  ]);
  bad('vector', [`[${u.join(', ')}] · [${v.join(', ')}] = ${dot + 2}`], 0);
  ok('vector', [`[${u.join(', ')}] × [${v.join(', ')}] = [${cross.join(', ')}]`]);
  bad(
    'vector',
    [
      `[${u.join(', ')}] × [${v.join(', ')}] = [${cross[0]}, ${-cross[1] === cross[1] ? cross[1] + 1 : -cross[1]}, ${cross[2]}]`,
    ],
    0,
  );
}
ok('vector', ['|[3, 4]| = sqrt(9 + 16) = 5']);
bad('vector', ['|[3, 4]| = sqrt(9 + 16) = 7'], 0);

// Units --------------------------------------------------------------------------------------------------------------
for (const [d, t] of [
  [150, 2],
  [90, 3],
  [36, 1],
  [240, 4],
]) {
  const v = d / t;
  ok('units', [`${d} km / (${t} h) = ${v} km/h`, `= ${(v * 1000) / 3600} m/s`]);
  bad('units', [`${d} km / (${t} h) = ${v} km/h`, `= ${v * 3.6} m/s`], 1);
}
for (const [km, m] of [
  [2, 300],
  [1, 450],
  [3, 75],
]) {
  ok('units', [`${km} km + ${m} m = ${km * 1000 + m} m`]);
  bad('units', [`${km} km + ${m} m = ${km + m} m`], 0);
}
ok('units', ['5 kg * 2 m/s^2 = 10 N']);
bad('units', ['5 kg * 2 m/s^2 = 10 J'], 0);
ok('units', ['3 m * 4 m = 12 m^2']);
bad('units', ['3 m * 4 m = 12 km'], 0);
ok('units', ['60 min = 3600 s']);
bad('units', ['60 min = 600 s'], 0);

// Inequalities -------------------------------------------------------------------------------------------------------
for (const [a, b, c] of [
  [-2, 1, 5],
  [-3, 4, -2],
  [-5, -1, 9],
  [-4, 2, 10],
]) {
  const bound = frac(c - b, a);
  ok('inequality', [`${co(a)} ${sg(b)} > ${c}`, `${co(a)} > ${c - b}`, `x < ${bound}`]);
  bad('inequality', [`${co(a)} ${sg(b)} > ${c}`, `${co(a)} > ${c - b}`, `x > ${bound}`], 2);
}
for (const [a, b, c] of [
  [2, 1, 5],
  [3, -4, 8],
]) {
  ok('inequality', [`${co(a)} ${sg(b)} <= ${c}`, `${co(a)} <= ${c - b}`, `x <= ${frac(c - b, a)}`]);
  bad('inequality', [`${co(a)} ${sg(b)} <= ${c}`, `${co(a)} <= ${c + b}`, `x <= ${frac(c + b, a)}`], 1);
}
for (const k of [2, 3, 5]) {
  ok('inequality', [`x^2 < ${k * k}`, `-${k} < x < ${k}`]);
  bad('inequality', [`x^2 < ${k * k}`, `x < ${k}`], 1);
  ok('inequality', [`x^2 > ${k * k}`, `x < -${k} or x > ${k}`]);
}
for (const [a, b] of [
  [1, 3],
  [2, 5],
  [-1, 4],
]) {
  ok('inequality', [`abs(x ${sg(-a)}) <= ${b}`, `-${b} <= x ${sg(-a)} <= ${b}`, `${a - b} <= x <= ${a + b}`]);
  bad('inequality', [`abs(x ${sg(-a)}) <= ${b}`, `-${b} <= x ${sg(-a)} <= ${b}`, `${-b - a} <= x <= ${b - a}`], 2);
}

// Homework pages: several problems one after another, set apart by a blank line, a number, or a title. Each problem
// is checked on its own; a slip in the second is still found. --------------------------------------------------------
for (const [a, b, x, c, d, y] of [
  [2, 3, 2, 3, -1, 3],
  [5, -4, 1, 2, 7, -2],
  [4, 1, 3, 3, 5, 4],
  [3, 6, -1, 7, -2, 1],
]) {
  const [r1, r2] = [a * x + b, c * y + d];
  const first = [`${co(a)} ${sg(b)} = ${r1}`, `${co(a)} = ${r1 - b}`, `x = ${x}`];
  const second = (v: string, answer: number) => [
    `${co(c, v)} ${sg(d)} = ${r2}`,
    `${co(c, v)} = ${r2 - d}`,
    `${v} = ${answer}`,
  ];
  ok('page', [...first, '', ...second('x', y)]);
  ok('page', [...first, `Problem 2`, ...second('x', y)]);
  ok('page', [`1) ${first[0]}`, ...first.slice(1), `2) ${second('x', y)[0]}`, ...second('x', y).slice(1)]);
  ok('page', [`Q1: ${first[0]}`, ...first.slice(1), `Q2: ${second('x', y)[0]}`, ...second('x', y).slice(1)]);
  ok('page', [...first, ...second('y', y)]);
  bad('page', [...first, '', ...second('x', y + 1)], 6);
  bad('page', [...first, `2. ${second('x', y)[0]}`, `${co(c)} = ${r2 + d}`, `x = ${frac(r2 + d, c)}`], 4);
}

// Systems written one equation to a line: substitution and elimination. --------------------------------------------
for (const [x, y, k] of [
  [2, 6, 3],
  [1, 4, 4],
  [3, -6, -2],
  [-2, -10, 5],
]) {
  // y = k x and x + y = s: substitute, solve for x, then back for y.
  const s = x + y;
  ok('stacked', [`y = ${co(k)}`, `x + y = ${s}`, `x + ${co(k)} = ${s}`, `${co(1 + k)} = ${s}`, `x = ${x}`, `y = ${y}`]);
  bad(
    'stacked',
    [`y = ${co(k)}`, `x + y = ${s}`, `x + ${co(k)} = ${s}`, `${co(1 + k)} = ${s}`, `x = ${x}`, `y = ${y + 2}`],
    5,
  );
  bad('stacked', [`y = ${co(k)}`, `x + y = ${s}`, `x + ${co(k)} = ${s + 1}`, `x = ${frac(s + 1, 1 + k)}`], 2);
}
for (const [x, y] of [
  [3, 1],
  [2, -1],
  [5, 2],
  [-1, 4],
]) {
  const [s, d] = [2 * x + y, x - y];
  ok('stacked', [`2x + y = ${s}`, `x - y = ${d}`, `3x = ${s + d}`, `x = ${x}`, `y = ${y}`]);
  ok('stacked', [`x = ${x}`, `y = x ${sg(y - x)}`, `y = ${y}`]);
  bad('stacked', [`2x + y = ${s}`, `x - y = ${d}`, `3x = ${s - d}`, `x = ${frac(s - d, 3)}`], 2);
  bad('stacked', [`2x + y = ${s}`, `x - y = ${d}`, `3x = ${s + d}`, `x = ${x}`, `y = ${y + 1}`], 4);
}

// Derivatives in Leibniz notation, after y = ... ---------------------------------------------------------------------
for (const [a, n] of [
  [3, 2],
  [2, 3],
  [5, 4],
  [4, 5],
]) {
  ok('leibniz', [`y = ${a}x^${n}`, `dy/dx = ${a * n}x^${n - 1}`]);
  ok('leibniz', [`y = ${a}x^${n}`, `y' = ${a * n}x^${n - 1}`]);
  bad('leibniz', [`y = ${a}x^${n}`, `dy/dx = ${a * n}x^${n}`], 1);
}

// Answers rounded at the last step, and notes in brackets. ----------------------------------------------------------
ok('rounding', ['sqrt(2)', '= 1.414']);
ok('rounding', ['2 pi', '= 6.28']);
ok('rounding', ['x = 1/3 = 0.33']);
ok('rounding', ['3x = 7', 'x = 7/3', 'x ≈ 2.33']);
ok('rounding', ['3x = 2', 'x = 0.67']);
ok('rounding', ['x^2 = 2', 'x = 1.41 or x = -1.41']);
bad('rounding', ['sqrt(2)', '= 1.42', '= 1.420'], 1);
bad('rounding', ['3x = 7', 'x = 2.5'], 1);
ok('notes', ['2x = 6 (divide by 2)', 'x = 3']);
ok('notes', ['2x + 3 = 7 [subtract 3]', '2x = 4 (divide both sides by 2)', 'x = 2']);
ok('notes', ['d/dx(x^3) at x = 2', '= 12']);
bad('notes', ['2x = 6 (divide by 2)', 'x = 4'], 1);
bad('notes', ['d/dx(x^3) at x = 2', '= 4'], 1);

// Units with one-letter names, and mixed numbers. --------------------------------------------------------------------
ok('units', ['10 m / 2 s', '= 5 m/s']);
bad('units', ['5 m + 3 s = 8 m'], 0);
bad('units', ['2 m * 3 m = 6 m'], 0);
ok('mixed', ['1 1/2 + 1/2 = 2']);
ok('mixed', ['2 1/4 + 1 3/4', '= 4']);
bad('mixed', ['1 1/2 + 1/2', '= 3'], 1);

// Correct steps that are easy to mistake for slips: squaring both sides, a lost solution, an extra solution, absolute
// values, partial fractions, and forms that only agree where both have a value. None of them may be called broken.
ok('precision', ['sqrt(x + 3) = x - 3', 'x + 3 = (x - 3)^2', 'x^2 - 7x + 6 = 0', 'x = 1 or x = 6']);
ok('precision', ['x^2 = 9', 'x = 3']);
ok('precision', ['x(x - 2) = 0', 'x = 0 or x = 2']);
ok('precision', ['e^x = e^(2x - 3)', 'x = 2x - 3', 'x = 3']);
ok('precision', ['abs(x) = 5', 'x = 5 or x = -5']);
ok('precision', ['(x + 1)/(x - 1) = 2', 'x + 1 = 2(x - 1)', 'x + 1 = 2x - 2', 'x = 3']);
ok('precision', ['x^3 - x = 0', 'x(x - 1)(x + 1) = 0', 'x = 0 or x = 1 or x = -1']);
ok('precision', ['sin(x)/cos(x)', '= tan(x)']);
ok('precision', ['sqrt(x^2)', '= abs(x)']);
ok('precision', ['sqrt(x^2)', '= x']);
ok('precision', ['1/(x(x + 1))', '= 1/x - 1/(x + 1)']);
ok('precision', ['(x^3 - 8)/(x - 2)', '= x^2 + 2x + 4']);
ok('precision', ['ln(x^2)', '= 2 ln(x)']);
ok('precision', ['x^2 = 2x', 'x = 2']);
ok('precision', ['2^x = 8', 'x ln(2) = ln(8)', 'x = ln(8)/ln(2)', 'x = 3']);
ok('precision', ['y = 2x + 3', 'y - 3 = 2x', 'x = (y - 3)/2']);
ok('precision', ['∫ 1/x dx = ln(abs(x)) + C']);
ok('precision', ['∫ sin(x) cos(x) dx = sin(x)^2/2 + C']);
ok('precision', ['∫ sin(x) cos(x) dx = -cos(x)^2/2 + C']);
ok('precision', ['∫ 2x dx', '= x^2 + 5']);
ok('precision', ['so 2x = 4', 'therefore x = 2']);
ok('precision', ['x^2 + 1 = 0', 'x^2 = -1']);
ok('precision', ['1/x > 2', '0 < x < 1/2']);
ok('precision', ['x/(x - 1) >= 0', 'x <= 0 or x > 1']);
ok('precision', ['3 + 4 * 2 = 3 + 8 = 11']);
ok('precision', ['the answer is below']);
ok('precision', ['d/dx(x^x) = x^x (ln(x) + 1)']);
ok('precision', ['cos(x)^2', '= (1 + cos(2x))/2']);
ok('precision', ['tan(2x)', '= 2tan(x)/(1 - tan(x)^2)']);

answerFamilies(ok, bad);
notationFamilies(ok, bad);

writeFileSync(new URL('./corpus.json', import.meta.url), `${JSON.stringify({ correct, broken }, null, 1)}\n`);
console.log(`correct ${correct.length}, broken ${broken.length}`);
