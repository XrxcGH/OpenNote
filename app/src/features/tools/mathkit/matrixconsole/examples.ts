// Scripts a student can load to see how the console works. The names are in the strings; the code is code.
const PLOT = [
  'x = linspace(0, 2*pi, 100);',
  'plot(x, sin(x));',
  'hold on',
  'plot(x, cos(x));',
  "legend('sin', 'cos');",
  "xlabel('x');",
  "title('Sine and cosine')",
];

export const EXAMPLES: readonly { id: string; code: string }[] = [
  { id: 'solve', code: 'A = [4 -2; 1 1];\nb = [2; 3];\nx = A\\b' },
  { id: 'eigen', code: 'A = [4 1; 2 3];\n[V, D] = eig(A)' },
  { id: 'loop', code: 's = 0;\nfor k = 1:10\n  s = s + k;\nend\ns' },
  { id: 'plot', code: PLOT.join('\n') },
  { id: 'fit', code: "x = [0 1 2 3]';\ny = [1 3 4 4]';\nA = [ones(4, 1) x];\nc = A\\y" },
  { id: 'elementwise', code: 'A = [1 2; 3 4];\nA * A\nA .* A' },
  { id: 'logical', code: 'v = [3 8 1 9 4];\nbig = v(v > 3)\nidx = find(v > 3)' },
  {
    id: 'newton',
    code: "x = 1;\nfor k = 1:6\n  x = x - (x^2 - 2) / (2*x);\n  fprintf('%d: %.10f\\n', k, x);\nend",
  },
];
