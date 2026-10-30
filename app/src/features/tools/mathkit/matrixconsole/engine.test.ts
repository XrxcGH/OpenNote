import { describe, expect, it } from 'vitest';
import { Session, type Entry } from './interp';
import { EXAMPLES } from './examples';
import type { M } from './values';

function run(...lines: string[]): { s: Session; entries: Entry[]; out: string } {
  const s = new Session();
  const entries = s.run(lines.join('\n'));
  const out = entries.flatMap((e) => (e.kind === 'out' ? e.lines : [])).join('\n');
  return { s, entries, out };
}
const get = (s: Session, name: string): M => s.vars.get(name) as M;
const error = (entries: Entry[]) =>
  entries.find((e) => e.kind === 'err') as Extract<Entry, { kind: 'err' }> | undefined;
const rows = (m: M) => Array.from({ length: m.r }, (_, i) => m.d.slice(i * m.c, (i + 1) * m.c));

describe('the planned validation cases', () => {
  it('A = [4 -2; 1 1]; eig(A) is the column 2, 3', () => {
    const { s, out } = run('A = [4 -2; 1 1]; eig(A)');
    expect(get(s, 'ans').d).toEqual([expect.closeTo(2, 12), expect.closeTo(3, 12)]);
    expect(get(s, 'ans').c).toBe(1);
    expect(out).toContain('ans =');
  });
  it('det(A) is 6 and A\\[2; 3] is (1.3333, 1.6667)', () => {
    const { s, out } = run('A = [4 -2; 1 1];', 'd = det(A)', 'x = A\\[2; 3]');
    expect(get(s, 'd').d[0]).toBeCloseTo(6, 12);
    expect(get(s, 'x').d[0]).toBeCloseTo(4 / 3, 12);
    expect(get(s, 'x').d[1]).toBeCloseTo(5 / 3, 12);
    expect(out).toContain('d = 6');
    expect(out).toContain('1.3333');
    expect(out).toContain('1.6667');
  });
  it('linspace(0, 1, 5) and 1:3:10', () => {
    const { s } = run('a = linspace(0, 1, 5); b = 1:3:10;');
    expect(get(s, 'a').d).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(get(s, 'b').d).toEqual([1, 4, 7, 10]);
  });
  it("A(end, 1), A', and A .* A", () => {
    const { s } = run('A = [4 -2; 1 1];', "p = A(end, 1); t = A'; q = A .* A;");
    expect(get(s, 'p').d).toEqual([1]);
    expect(rows(get(s, 't'))).toEqual([
      [4, 1],
      [-2, 1],
    ]);
    expect(rows(get(s, 'q'))).toEqual([
      [16, 4],
      [1, 1],
    ]);
  });
  it('[1 2] * [3 4] is an inner dimensions error', () => {
    const { entries } = run('[1 2] * [3 4]');
    expect(error(entries)?.code).toBe('mcInnerDims');
  });
  it('a for loop sums 1 to 10', () => {
    const { s, out } = run('s = 0; for k = 1:10, s = s + k; end; s');
    expect(get(s, 's').d).toEqual([55]);
    expect(out).toContain('s = 55');
  });
});

describe('reading and printing', () => {
  it('a space inside brackets separates values, and a space after a minus makes it a subtraction', () => {
    const { s } = run("a = [1 -2]; b = [1 - 2]; c = [1 , 2; 3 4]; d = [a' a'];");
    expect(get(s, 'a').d).toEqual([1, -2]);
    expect(get(s, 'b').d).toEqual([-1]);
    expect(rows(get(s, 'c'))).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(rows(get(s, 'd'))).toEqual([
      [1, 1],
      [-2, -2],
    ]);
  });
  it('the quote is a transpose after a value and text after a space in brackets', () => {
    const { s } = run("x = [1 2 3]'; t = 'it''s';");
    expect(get(s, 'x').r).toBe(3);
    expect(get(s, 't').str).toBe("it's");
  });
  it('follows the precedence of ^ and unary minus', () => {
    const { s } = run('a = -2^2; b = 2^-1; c = 2^3^2; d = 1:3 + 1;');
    expect(get(s, 'a').d).toEqual([-4]);
    expect(get(s, 'b').d).toEqual([0.5]);
    expect(get(s, 'c').d).toEqual([64]);
    expect(get(s, 'd').d).toEqual([1, 2, 3, 4]);
  });
  it('prints like MATLAB short format', () => {
    expect(run('x = 5').out).toBe('x = 5');
    expect(run('x = 1.5').out).toBe('x = 1.5000');
    expect(run('x = pi*1000').out).toBe('x = 3.1416e+03');
    expect(run('A = [1 2; 3 4]').out).toBe('A =\n\n     1     2\n     3     4\n');
    expect(run('A = [1.5 2.25]').out).toBe('A =\n\n    1.5000    2.2500\n');
    expect(run('x = [1 NaN]').out).toContain('NaN');
    expect(run('x = 1/0').out).toBe('x = Inf');
    expect(run("s = 'hello'").out).toBe('s = hello');
  });
  it('a semicolon hides the result and ans holds the last unnamed one', () => {
    const { s, out } = run('3 + 4;', 'ans * 2');
    expect(out).toBe('ans = 14');
    expect(get(s, 'ans').d).toEqual([14]);
  });
  it('ignores comments and continues lines', () => {
    const { s } = run('x = 1 + ... comment', '  2; % another', 'y = 3 # also');
    expect(get(s, 'x').d).toEqual([3]);
    expect(get(s, 'y').d).toEqual([3]);
  });
});

describe('matrices and indexing', () => {
  it('indexes down the columns, as MATLAB does', () => {
    const { s } = run('A = [1 2 3; 4 5 6];', "a = A(2); b = A(:)'; c = A(2, :); d = A(:, end); e = A(end);");
    expect(get(s, 'a').d).toEqual([4]);
    expect(get(s, 'b').d).toEqual([1, 4, 2, 5, 3, 6]);
    expect(get(s, 'c').d).toEqual([4, 5, 6]);
    expect(get(s, 'd').d).toEqual([3, 6]);
    expect(get(s, 'e').d).toEqual([6]);
  });
  it('logical indexing picks and assigns', () => {
    const { s } = run("A = [1 2; 3 4]; v = A(A > 1)'; A(A > 2) = 0;");
    expect(get(s, 'v').d).toEqual([3, 2, 4]);
    expect(rows(get(s, 'A'))).toEqual([
      [1, 2],
      [0, 0],
    ]);
  });
  it('grows on assignment and deletes with an empty matrix', () => {
    const { s } = run('x = []; x(3) = 7; y = 1:5; y(2) = []; A = eye(3); A(2, :) = []; A(:, 1) = [];');
    expect(get(s, 'x').d).toEqual([0, 0, 7]);
    expect(get(s, 'y').d).toEqual([1, 3, 4, 5]);
    expect(rows(get(s, 'A'))).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });
  it('x(end+1) appends', () => {
    const { s } = run('x = [1 2]; x(end+1) = 3; x(end+1) = 4;');
    expect(get(s, 'x').d).toEqual([1, 2, 3, 4]);
  });
  it('broadcasts a row against a column and element-wise powers', () => {
    const { s } = run('a = [1 2 3] + [10; 20]; b = [1 2 3] .^ 2; c = 2 .^ [1 2 3];');
    expect(rows(get(s, 'a'))).toEqual([
      [11, 12, 13],
      [21, 22, 23],
    ]);
    expect(get(s, 'b').d).toEqual([1, 4, 9]);
    expect(get(s, 'c').d).toEqual([2, 4, 8]);
  });
  it('matrix power, inverse, and the identity', () => {
    const { s } = run('A = [2 1; 5 3]; B = inv(A); C = A^2; I = A*B;');
    expect(rows(get(s, 'B'))).toEqual(
      [
        [3, -1],
        [-5, 2],
      ].map((r) => r.map((v) => expect.closeTo(v, 12))),
    );
    expect(rows(get(s, 'C'))).toEqual([
      [9, 5],
      [25, 14],
    ]);
    expect(get(s, 'I').d[0]).toBeCloseTo(1, 12);
  });
  it('builds the standard matrices', () => {
    const { s } = run('a = zeros(2, 3); b = ones(2); c = eye(3); d = magic(3); e = magic(4); f = magic(6);');
    expect(get(s, 'a').r).toBe(2);
    expect(get(s, 'a').c).toBe(3);
    expect(get(s, 'b').d).toEqual([1, 1, 1, 1]);
    expect(rows(get(s, 'd'))).toEqual([
      [8, 1, 6],
      [3, 5, 7],
      [4, 9, 2],
    ]);
    expect(rows(get(s, 'e'))).toEqual([
      [16, 2, 3, 13],
      [5, 11, 10, 8],
      [9, 7, 6, 12],
      [4, 14, 15, 1],
    ]);
    expect(rows(get(s, 'f'))).toEqual([
      [35, 1, 6, 26, 19, 24],
      [3, 32, 7, 21, 23, 25],
      [31, 9, 2, 22, 27, 20],
      [8, 28, 33, 17, 10, 15],
      [30, 5, 34, 12, 14, 16],
      [4, 36, 29, 13, 18, 11],
    ]);
  });
  it('reshape fills down the columns', () => {
    const { s } = run('A = reshape(1:6, 2, 3);');
    expect(rows(get(s, 'A'))).toEqual([
      [1, 3, 5],
      [2, 4, 6],
    ]);
  });
});

describe('functions of the library', () => {
  it('reductions work down columns or along a vector', () => {
    const { s } = run(
      'A = [1 2; 3 4]; a = sum(A); b = sum(A, 2); c = mean(A(:)); d = max([3 9 2]); [m, i] = max([3 9 2]);',
    );
    expect(get(s, 'a').d).toEqual([4, 6]);
    expect(get(s, 'b').d).toEqual([3, 7]);
    expect(get(s, 'c').d).toEqual([2.5]);
    expect(get(s, 'd').d).toEqual([9]);
    expect(get(s, 'i').d).toEqual([2]);
  });
  it('sort, find, cumsum, any and all', () => {
    const { s } = run(
      "[a, k] = sort([3 1 2], 'descend'); f = find([0 1 0 1]); c = cumsum(1:4); t = any([0 0 1]); u = all([1 0]);",
    );
    expect(get(s, 'a').d).toEqual([3, 2, 1]);
    expect(get(s, 'k').d).toEqual([1, 3, 2]);
    expect(get(s, 'f').d).toEqual([2, 4]);
    expect(get(s, 'c').d).toEqual([1, 3, 6, 10]);
    expect(get(s, 't').d).toEqual([1]);
    expect(get(s, 'u').d).toEqual([0]);
  });
  it('mod and rem follow MATLAB signs, and round goes away from zero', () => {
    const { s } = run(
      'a = mod(-1, 3); b = rem(-1, 3); c = round(-2.5); d = round(2.5); e = fix(-2.7); g = gcd(12, 18);',
    );
    expect(get(s, 'a').d).toEqual([2]);
    expect(get(s, 'b').d).toEqual([-1]);
    expect(get(s, 'c').d).toEqual([-3]);
    expect(get(s, 'd').d).toEqual([3]);
    expect(get(s, 'e').d).toEqual([-2]);
    expect(get(s, 'g').d).toEqual([6]);
  });
  it('size with one and two outputs', () => {
    const { s } = run('A = zeros(2, 3); a = size(A); [r, c] = size(A); n = numel(A); l = length(A);');
    expect(get(s, 'a').d).toEqual([2, 3]);
    expect(get(s, 'r').d).toEqual([2]);
    expect(get(s, 'c').d).toEqual([3]);
    expect(get(s, 'n').d).toEqual([6]);
    expect(get(s, 'l').d).toEqual([3]);
  });
  it('the singular values of [3 2 2; 2 3 -2] are 5 and 3, and its rank is 2', () => {
    const { s } = run('A = [3 2 2; 2 3 -2]; v = svd(A); r = rank(A); n = norm(A);');
    expect(get(s, 'v').d[0]).toBeCloseTo(5, 12);
    expect(get(s, 'v').d[1]).toBeCloseTo(3, 12);
    expect(get(s, 'r').d).toEqual([2]);
    expect(get(s, 'n').d[0]).toBeCloseTo(5, 12);
  });
  it('lu, qr, and chol rebuild the matrix', () => {
    const { s } = run(
      'A = [4 3 2; 6 3 1; 2 5 7];',
      '[L, U, P] = lu(A); e1 = norm(P*A - L*U);',
      "[Q, R] = qr(A); e2 = norm(Q*R - A); e3 = norm(Q'*Q - eye(3));",
      "S = [4 2; 2 3]; K = chol(S); e4 = norm(K'*K - S);",
    );
    for (const name of ['e1', 'e2', 'e3', 'e4']) expect(get(s, name).d[0]).toBeLessThan(1e-12);
    expect(get(s, 'R').d[0]).toBeLessThan(0);
  });
  it('[V, D] = eig(A) satisfies A V = V D', () => {
    const { s } = run(
      'A = [2 1; 1 2]; [V, D] = eig(A); e = norm(A*V - V*D);',
      'B = [4 1; 2 3]; [W, E] = eig(B); f = norm(B*W - W*E);',
    );
    expect(get(s, 'e').d[0]).toBeLessThan(1e-12);
    expect(get(s, 'f').d[0]).toBeLessThan(1e-9);
    expect(get(s, 'D').d).toEqual([expect.closeTo(1, 12), 0, 0, expect.closeTo(3, 12)]);
  });
  it('the least-squares line through four points, by polyfit and by backslash', () => {
    const { s } = run("x = [0 1 2 3]; y = [1 3 4 4]; p = polyfit(x, y, 1); A = [ones(4, 1) x']; c = A \\ y';");
    expect(get(s, 'p').d[0]).toBeCloseTo(1, 12);
    expect(get(s, 'p').d[1]).toBeCloseTo(1.5, 12);
    expect(get(s, 'c').d[0]).toBeCloseTo(1.5, 12);
    expect(get(s, 'c').d[1]).toBeCloseTo(1, 12);
  });
  it('polynomials, interpolation, and quadrature', () => {
    const { s } = run(
      'r = roots([1 -3 2]); v = polyval([1 0 -1], 3); c = conv([1 1], [1 -1]);',
      'q = interp1([0 1 2], [0 10 20], 1.5); t = trapz([0 1 2], [0 1 4]);',
      'z = fzero(@(x) x^2 - 2, [0 2]); I = integral(@(x) x.^2, 0, 3);',
    );
    expect(get(s, 'r').d).toEqual([expect.closeTo(2, 10), expect.closeTo(1, 10)]);
    expect(get(s, 'v').d).toEqual([8]);
    expect(get(s, 'c').d).toEqual([1, 0, -1]);
    expect(get(s, 'q').d).toEqual([15]);
    expect(get(s, 't').d).toEqual([3]);
    expect(get(s, 'z').d[0]).toBeCloseTo(Math.SQRT2, 12);
    expect(get(s, 'I').d[0]).toBeCloseTo(9, 10);
  });
  it('null space and kron', () => {
    const { s } = run('N = null([1 2 3; 2 4 6]); e = norm([1 2 3; 2 4 6] * N); K = kron([1 2], [1; 1]);');
    expect(get(s, 'N').c).toBe(2);
    expect(get(s, 'e').d[0]).toBeLessThan(1e-12);
    expect(rows(get(s, 'K'))).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });
});

describe('control flow, functions, and text', () => {
  it('if, elseif, else, while, break, and continue', () => {
    const { s } = run(
      'x = 5; if x < 3, y = 1; elseif x < 10, y = 2; else y = 3; end',
      'n = 0; while true, n = n + 1; if n >= 4, break; end; end',
      't = 0; for k = 1:6, if mod(k, 2) == 0, continue; end; t = t + k; end',
    );
    expect(get(s, 'y').d).toEqual([2]);
    expect(get(s, 'n').d).toEqual([4]);
    expect(get(s, 't').d).toEqual([9]);
  });
  it('for walks the columns of a matrix', () => {
    const { s } = run('t = 0; for c = [1 2; 3 4], t = t + c(1) * 10 + c(2); end');
    expect(get(s, 't').d).toEqual([10 + 3 + 20 + 4]);
  });
  it('anonymous functions capture values and can be passed around', () => {
    const { s, out } = run('a = 3; f = @(x) a*x.^2; g = @sin; y = f(2); z = g(0); h = feval(f, [1 2]);', 'f');
    expect(get(s, 'y').d).toEqual([12]);
    expect(get(s, 'z').d).toEqual([0]);
    expect(get(s, 'h').d).toEqual([3, 12]);
    expect(out).toContain('@(x) a*x.^2');
  });
  it('fprintf and sprintf cycle the format over the values', () => {
    const { entries, s } = run(
      "fprintf('%d, ', [1 2 3]); fprintf('\\n'); fprintf('%5.2f|%-4d|%s\\n', pi, 7, 'ab'); t = sprintf('%d-%d', 1, 2);",
    );
    const lines = entries.flatMap((e) => (e.kind === 'out' ? e.lines : []));
    expect(lines[0]).toBe('1, 2, 3, ');
    expect(lines.some((l) => l === ' 3.14|7   |ab')).toBe(true);
    expect(get(s, 't').str).toBe('1-2');
  });
  it('num2str, mat2str, and disp', () => {
    const { s, out } = run(
      "a = num2str(pi); b = num2str(42); c = mat2str([1 2; 3 4.5]); disp(a); disp([1 2 3]); disp('hi')",
    );
    expect(get(s, 'a').str).toBe('3.1416');
    expect(get(s, 'b').str).toBe('42');
    expect(get(s, 'c').str).toBe('[1 2;3 4.5]');
    expect(out).toContain('3.1416');
    expect(out).toContain('hi');
  });
  it('keeps variables between runs', () => {
    const s = new Session();
    s.run('x = 4;');
    const entries = s.run('y = x * 2');
    expect((entries.find((e) => e.kind === 'out') as Extract<Entry, { kind: 'out' }>).lines[0]).toBe('y = 8');
  });
});

describe('plots', () => {
  it('plot draws a series and hold keeps the earlier ones', () => {
    const { entries } = run("x = 0:3; plot(x, x.^2); hold on; plot(x, x); xlabel('x'); title('two')");
    const plot = entries.find((e) => e.kind === 'plot') as Extract<Entry, { kind: 'plot' }>;
    expect(plot.figure.series).toHaveLength(2);
    expect(plot.figure.series[0].y).toEqual([0, 1, 4, 9]);
    expect(plot.figure.title).toBe('two');
  });
  it('fplot samples a function handle', () => {
    const { entries } = run('fplot(@(x) x.^2, [0 2])');
    const plot = entries.find((e) => e.kind === 'plot') as Extract<Entry, { kind: 'plot' }>;
    expect(plot.figure.series[0].y[plot.figure.series[0].y.length - 1]).toBeCloseTo(4, 12);
  });
});

describe('problems are reported, not thrown', () => {
  it('names the problem for each kind of mistake', () => {
    const code = (src: string) => error(run(src).entries)?.code;
    expect(code('x = y + 1')).toBe('mcUndefined');
    expect(code('A = [1 2; 3 4]; A(0)')).toBe('mcIndexPositive');
    expect(code('A = [1 2; 3 4]; A(5)')).toBe('mcIndexRange');
    expect(code('A = [1 2; 3 4]; A(3, 1)')).toBe('mcIndexRange');
    expect(code('[1 2 3] + [1 2]')).toBe('mcDimsAgree');
    expect(code('[1 2; 3]')).toBe('mcCatDims');
    expect(code('sqrt(-1)')).toBe('mcComplex');
    expect(code('det([1 2 3])')).toBe('mcSquare');
    expect(code('x = (1 + ')).toBe('mcSyntax');
    expect(code('1 +* 2')).toBe('mcSyntax');
    expect(code("error('stop %d', 3)")).toBe('mcUser');
    expect(code('zeros(100000, 100000)')).toBe('mcTooBig');
    expect(code('end')).toBe('mcSyntax');
    expect(code('if 1, x = 1;')).toBe('mcSyntax');
    expect(code('chol([1 2; 2 1])')).toBe('mcNotPositiveDefinite');
    expect(code('ones(2, 3) \\ ones(3, 1)')).toBe('mcInnerDims');
    expect(code('x = 3; x(2, 2, 2)')).toBe('mcNotSupported');
  });
  it('stops a script that never ends', () => {
    const t0 = performance.now();
    const { entries } = run('while true, end');
    expect(error(entries)?.code).toBe('mcStepLimit');
    expect(performance.now() - t0).toBeLessThan(15000);
  }, 20000);
  it('nests function handles built in a loop', () => {
    const { entries } = run('f = @(x) x; for k = 1:3, f = @(x) f(x) + 1; end; f(1)');
    expect(error(entries)).toBeUndefined();
  });
  it('warns about a singular matrix and gives Inf', () => {
    const { entries, s } = run('x = [1 2; 2 4] \\ [1; 2];');
    expect(entries.some((e) => e.kind === 'note' && e.key === 'warnSingular')).toBe(true);
    expect(get(s, 'x').d.every((v) => v === Infinity)).toBe(true);
  });
  it('explains operators when asked', () => {
    const s = new Session();
    s.explain = true;
    const entries = s.run('A = [1 2; 3 4]; B = A * A; C = A .* A; D = A\\[1; 2];');
    const keys = entries.filter((e) => e.kind === 'note').map((e) => (e as Extract<Entry, { kind: 'note' }>).key);
    expect(keys).toEqual(expect.arrayContaining(['explainMatmul', 'explainElementwise', 'explainSolve']));
  });
  it('uses the same random numbers each session', () => {
    const a = run('x = rand(1, 3);').s;
    const b = run('x = rand(1, 3);').s;
    expect(get(a, 'x').d).toEqual(get(b, 'x').d);
    expect(get(a, 'x').d.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('the examples', () => {
  for (const example of EXAMPLES) {
    it(`${example.id} runs without a problem`, () => {
      const { entries } = run(example.code);
      expect(error(entries)).toBeUndefined();
    });
  }
  it('the Newton example reaches the square root of 2', () => {
    const { s } = run(EXAMPLES.find((x) => x.id === 'newton')!.code);
    expect(get(s, 'x').d[0]).toBeCloseTo(Math.SQRT2, 14);
  });
});

describe('printing zeros and underdetermined systems', () => {
  it('prints an exact zero in a decimal matrix as 0, like MATLAB', () => {
    const { out } = run("x = linspace(0, 1, 3)'");
    expect(out.split('\n').map((l) => l.trim())).toEqual(expect.arrayContaining(['0', '0.5000', '1.0000']));
    expect(out).not.toContain('0.0000');
  });
  it('prints the L and U of lu with 0 in the zero places', () => {
    const { out } = run('A = [4 3; 6 3.5]; [L, U] = lu(A); L');
    expect(out).toMatch(/\b0\b/);
    expect(out).not.toContain('0.0000');
  });
  it('says that A\\b for an underdetermined system is the minimum-norm solution, equal to pinv(A)*b', () => {
    const { s, entries } = run('A = [1 1 1]; b = 3; x = A\\b; y = pinv(A)*b;');
    expect(entries.some((e) => e.kind === 'note' && e.key === 'warnMinimumNorm')).toBe(true);
    // The minimum-norm solution of x1 + x2 + x3 = 3 is (1, 1, 1); a basic solution would be (3, 0, 0).
    for (let i = 0; i < 3; i++) {
      expect(get(s, 'x').d[i]).toBeCloseTo(1, 12);
      expect(get(s, 'y').d[i]).toBeCloseTo(1, 12);
    }
  });
});
