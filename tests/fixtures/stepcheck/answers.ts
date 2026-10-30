// Corpus families for how students finish and check an answer: roots written one to a line, the answer put back in
// (with LHS and RHS labels), and the marks around an answer. Called by generate.ts; expected values are worked out
// here by plain arithmetic.
type Add = (topic: string, lines: string[]) => void;
type AddBroken = (topic: string, lines: string[], at: number) => void;

export function answerFamilies(ok: Add, bad: AddBroken): void {
  // Roots written one to a line, and a check of the answer by putting it back in, as students write them.
  const sum = (a: number, b: number) => (b < 0 ? `${a} - ${-b}` : `${a} + ${b}`);
  const termX = (k: number) => (k === 0 ? '' : k < 0 ? ` - ${k === -1 ? '' : -k}x` : ` + ${k === 1 ? '' : k}x`);
  const constant = (k: number) => (k === 0 ? '' : k < 0 ? ` - ${-k}` : ` + ${k}`);
  const shift = (r: number) => (r < 0 ? `(x + ${-r})` : `(x - ${r})`);
  for (const [r1, r2] of [
    [2, 3],
    [1, -4],
    [-2, -5],
    [3, 7],
    [-1, 6],
  ]) {
    const quad = `x^2${termX(-(r1 + r2))}${constant(r1 * r2)} = 0`;
    ok('roots', [quad, `${shift(r1)}${shift(r2)} = 0`, `x = ${r1}`, `x = ${r2}`]);
    ok('roots', [quad, `x = ${r1}`, `x = ${r2}`]);
    // The second root miscopied: x = r2 + 1 solves neither line above it.
    bad('roots', [quad, `${shift(r1)}${shift(r2)} = 0`, `x = ${r1}`, `x = ${r2 + 1}`], 3);
  }
  for (const k of [2, 3, 4, 5, 9]) {
    ok('roots', [`x^2 = ${k * k}`, `x = ${k}`, `x = -${k}`]);
    bad('roots', [`x^2 = ${k * k}`, `x = ${k}`, `x = ${k * k}`], 2);
  }
  // The quadratic formula with ±: x^2 + bx + c = 0 with roots r1, r2, so b = -(r1 + r2) and the discriminant is (r1 - r2)^2.
  for (const [r1, r2] of [
    [1, -3],
    [2, -4],
    [5, -1],
  ]) {
    const b = -(r1 + r2);
    const d = Math.abs(r1 - r2);
    const quad = `x^2${termX(b)}${constant(r1 * r2)} = 0`;
    ok('roots', [quad, `x = (${-b} ± ${d})/2`, `x = ${Math.max(r1, r2)}`, `x = ${Math.min(r1, r2)}`]);
  }
  for (const [a, c, x] of [
    [3, -4, 5],
    [2, 7, 3],
    [4, -1, 2],
    [5, 3, -2],
  ]) {
    const rhs = a * x + c;
    const sub = x < 0 ? `(${x})` : `(${x})`;
    ok('answer-check', [
      `${a}x${constant(c)} = ${rhs}`,
      `x = ${x}`,
      `${a}${sub}${constant(c)}`,
      `= ${sum(a * x, c)}`,
      `= ${rhs}`,
    ]);
    ok('answer-check', [`${a}x${constant(c)} = ${rhs}`, `x = ${x}`, `LHS = ${a}${sub}${constant(c)} = ${rhs} = RHS`]);
    ok('answer-check', [`x = ${x}`, `${a}x`, `= ${a * x}`]);
    ok('answer-check', [`x = ${x}`, `y = ${a}x = ${a * x}`]);
    // A slip in the arithmetic of the check itself.
    bad('answer-check', [`x = ${x}`, `${a}x`, `= ${a * x + 1}`], 2);
  }
  ok('answer-check', ['x = 5', '3(5) - 4', '= 15 - 4', '= 11']);
  ok('answer-check', ['x = 3', '2x', '= 6']);
  ok('answer-check', ['x = 5', 'x^2', '= 25']);
  ok('answer-check', ['x = 5', '(2+3)(4+5)', '= 45']);
  ok('labels', ['LHS = 3(5) - 4 = 11 = RHS']);
  ok('labels', ['let a = b = c']);
  ok('labels', ['x = y = z = w']);
  ok('labels', ['2x = 10', 'x = 5 ✓']);
  ok('labels', ['2x = 10', 'ans: x = 5']);
  ok('labels', ['½x = 4', 'x = 8']);
  ok('labels', ['x^2 - 5x + 6 = 0', 'x = 2, 3']);
  ok('labels', ['x^2 - 5x + 6 = 0', 'x ∈ {2, 3}']);
  ok('labels', ['25% of 80 = 20']);
}
