// checks-disable-file length: reference tables are long rows of data, and wrapping them would make them harder to compare

// Reference content for the programming references tool. Everything here is original text written for OpenNote.
// Each card has a group, a short title, a plain explanation, and optionally a code sample.

export type RefGroup = 'precedence' | 'types' | 'escapes' | 'errors' | 'matlab';

export interface RefCard {
  id: string;
  group: RefGroup;
  title: string;
  body: string;
  code?: string;
  /** Extra words the search also matches. */
  tags?: string;
}

/** C++ operators from the tightest binding (rank 1) to the loosest. Operators of one rank share a row. */
export const PRECEDENCE: readonly {
  rank: number;
  ops: readonly string[];
  assoc: 'left' | 'right' | 'none';
  note: string;
}[] = [
  { rank: 1, ops: ['::'], assoc: 'left', note: 'Scope: picks a name out of a namespace or class.' },
  {
    rank: 2,
    ops: ['a++', 'a--', '()', '[]', '.', '->'],
    assoc: 'left',
    note: 'Postfix: calls, indexing, member access, and after-the-fact increment.',
  },
  {
    rank: 3,
    ops: ['++a', '--a', '+a', '-a', '!', '~', '(type)', '*a', '&a', 'sizeof', 'new', 'delete'],
    assoc: 'right',
    note: 'Prefix and unary: they apply to the thing on their right.',
  },
  { rank: 4, ops: ['.*', '->*'], assoc: 'left', note: 'Pointer to member: rare.' },
  { rank: 5, ops: ['*', '/', '%'], assoc: 'left', note: 'Multiply, divide, remainder.' },
  { rank: 6, ops: ['+', '-'], assoc: 'left', note: 'Add and subtract.' },
  { rank: 7, ops: ['<<', '>>'], assoc: 'left', note: 'Bit shifts, and stream insertion and extraction.' },
  { rank: 8, ops: ['<=>'], assoc: 'left', note: 'Three-way comparison (C++20).' },
  { rank: 9, ops: ['<', '<=', '>', '>='], assoc: 'left', note: 'Relational: order comparisons.' },
  {
    rank: 10,
    ops: ['==', '!='],
    assoc: 'left',
    note: 'Equality: binds looser than relational, so a < b == c < d compares two truth values.',
  },
  { rank: 11, ops: ['&'], assoc: 'left', note: 'Bitwise and.' },
  { rank: 12, ops: ['^'], assoc: 'left', note: 'Bitwise exclusive or.' },
  { rank: 13, ops: ['|'], assoc: 'left', note: 'Bitwise or.' },
  { rank: 14, ops: ['&&'], assoc: 'left', note: 'Logical and: stops early when the left side is false.' },
  { rank: 15, ops: ['||'], assoc: 'left', note: 'Logical or: stops early when the left side is true.' },
  {
    rank: 16,
    ops: ['?:', '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=', 'throw'],
    assoc: 'right',
    note: 'Conditional and assignment: a = b = c assigns right to left.',
  },
  { rank: 17, ops: [','], assoc: 'left', note: 'Comma: evaluates the left side, then the right.' },
];

/** The rank of an operator in the table (lower binds tighter), or null when it is not listed. */
export function rankOf(op: string): number | null {
  for (const row of PRECEDENCE) if (row.ops.includes(op)) return row.rank;
  return null;
}

/** Which of two binary operators is grouped first in `x op1 y op2 z`: 'first', 'second', or 'left-to-right' / 'right-to-left' at a tie. */
export function groupsFirst(op1: string, op2: string): 'first' | 'second' | 'left-to-right' | 'right-to-left' | null {
  const a = rankOf(op1);
  const b = rankOf(op2);
  if (a === null || b === null) return null;
  if (a < b) return 'first';
  if (a > b) return 'second';
  const row = PRECEDENCE.find((r) => r.rank === a)!;
  return row.assoc === 'right' ? 'right-to-left' : 'left-to-right';
}

export const TYPE_CARDS: readonly RefCard[] = [
  {
    id: 'type-bool',
    group: 'types',
    title: 'bool',
    body: 'True or false. Usually one byte. Any number that is not zero becomes true when converted.',
    code: 'bool done = (n == 0);',
  },
  {
    id: 'type-char',
    group: 'types',
    title: 'char',
    body: 'One byte, used for text and for small numbers. Whether plain char is signed depends on the compiler, so use unsigned char or int8_t when the sign matters. Arithmetic on a char happens as int.',
    code: "char c = 'a';\nint next = c + 1;  // 98, an int",
  },
  {
    id: 'type-short-int',
    group: 'types',
    title: 'short, int, long, long long',
    body: 'Integers of growing size. The standard only promises short is at least 16 bits, int at least 16, long at least 32 and long long at least 64. In practice short is 16 bits and int is 32. long is 32 bits on Windows and 64 on Linux and macOS, which is a classic portability trap.',
    code: '#include <cstdint>\nint32_t exactly32 = 0;  // exact widths when it matters',
  },
  {
    id: 'type-unsigned',
    group: 'types',
    title: 'unsigned integers',
    body: 'Never negative, and they wrap around instead of overflowing: 0u - 1 is the largest value of the type. Mixing signed and unsigned in a comparison converts the signed one, which turns -1 into a huge number.',
    code: 'unsigned u = 0;\nu--;  // 4294967295 with a 32-bit unsigned',
  },
  {
    id: 'type-float',
    group: 'types',
    title: 'float, double, long double',
    body: 'Binary floating point: about 7, 16 and 18 or more decimal digits. 0.1 cannot be stored exactly, so compare with a tolerance, not ==. Dividing a double by zero gives infinity; integer division by zero is undefined behaviour.',
    code: 'double x = 0.1 + 0.2;\nbool same = (x == 0.3);  // false',
  },
  {
    id: 'type-size',
    group: 'types',
    title: 'sizeof and size_t',
    body: 'sizeof gives a size in bytes, as a size_t, an unsigned type big enough for any object. sizeof(char) is 1 by definition. An array decays to a pointer when passed to a function, so sizeof inside the function sees the pointer, not the array.',
    code: 'int a[10];\nsize_t bytes = sizeof a;        // 40 for 4-byte ints\nsize_t count = sizeof a / sizeof a[0];  // 10',
  },
  {
    id: 'type-division',
    group: 'types',
    title: 'Integer division and remainder',
    body: 'Dividing two integers drops the fraction, rounding toward zero: 7 / 2 is 3 and -7 / 2 is -3. The remainder takes the sign of the left side: -7 % 2 is -1. To get a fractional result make one side a floating type.',
    code: 'int a = 7 / 2;      // 3\ndouble b = 7 / 2.0; // 3.5',
  },
  {
    id: 'type-pointer',
    group: 'types',
    title: 'Pointers and references',
    body: 'A pointer holds an address and can be null or reassigned. A reference is another name for an existing object, must be set when created, and cannot be rebound. &x takes an address, *p follows one.',
    code: 'int x = 5;\nint* p = &x;\n*p = 7;      // x is now 7\nint& r = x;  // r is x',
  },
  {
    id: 'type-array',
    group: 'types',
    title: 'Arrays and pointer arithmetic',
    body: 'a[i] means *(a + i). Adding 1 to a pointer moves it by one element, not one byte. Indexing outside the array is undefined behaviour, not an error the program reports.',
    code: 'int a[3] = {1, 2, 3};\nint* q = a + 1;\n*q = 9;  // a is {1, 9, 3}',
  },
  {
    id: 'type-new',
    group: 'types',
    title: 'new and delete',
    body: 'new makes an object on the heap and returns its address. Every new needs one delete (new[] needs delete[]). Losing the last pointer to a block without deleting it is a leak; using a pointer after delete is a dangling pointer; deleting twice is a crash waiting to happen.',
    code: 'int* h = new int(4);\ndelete h;\nh = nullptr;',
  },
];

export const ESCAPE_CARDS: readonly RefCard[] = [
  {
    id: 'esc-n',
    group: 'escapes',
    title: '\\n  new line',
    body: 'Moves to the start of the next line. std::endl does the same and also flushes the output.',
    code: 'std::cout << "a\\nb";',
  },
  { id: 'esc-t', group: 'escapes', title: '\\t  tab', body: 'Jumps to the next tab stop, handy for aligning columns.' },
  {
    id: 'esc-r',
    group: 'escapes',
    title: '\\r  carriage return',
    body: 'Moves back to the start of the line without advancing. Windows text files end lines with \\r\\n.',
  },
  {
    id: 'esc-bs',
    group: 'escapes',
    title: '\\\\  backslash',
    body: 'A backslash has to be doubled inside a string or character literal.',
    code: 'std::string path = "C:\\\\data";',
  },
  {
    id: 'esc-q',
    group: 'escapes',
    title: '\\"  and  \\\'  quotes',
    body: 'A double quote inside a string, and a single quote inside a character literal.',
  },
  {
    id: 'esc-0',
    group: 'escapes',
    title: '\\0  null character',
    body: 'The zero byte that ends a C string. Strings written in quotes have one added automatically, so "hi" takes 3 bytes.',
  },
  {
    id: 'esc-a',
    group: 'escapes',
    title: '\\a  \\b  \\f  \\v',
    body: 'Alert (bell), backspace, form feed and vertical tab. Rarely needed.',
  },
  {
    id: 'esc-x',
    group: 'escapes',
    title: '\\xhh  \\ooo  \\uXXXX',
    body: 'A character by its code: two hex digits, up to three octal digits, or four hex digits of a Unicode code point.',
    code: "char a = '\\x41';  // 'A'",
  },
];

export const ERROR_CARDS: readonly RefCard[] = [
  {
    id: 'err-semicolon',
    group: 'errors',
    title: "expected ';' before ...",
    body: 'A statement ended without a semicolon. The compiler reports the line after the real mistake, so look at the end of the line above. Also check that a class or struct definition ends with };',
    code: 'int x = 5   // missing ;\nint y = 6;',
  },
  {
    id: 'err-scope',
    group: 'errors',
    title: "'x' was not declared in this scope",
    body: 'The name is unknown at that point. Common causes are a typo, a variable declared inside an inner block that has ended, a missing #include, or using a function before its declaration.',
    tags: 'undeclared identifier not defined',
  },
  {
    id: 'err-undefined',
    group: 'errors',
    title: 'undefined reference to ...',
    body: 'A linker error, not a compiler error: the function was declared and called but its body was never compiled into the program. Add the source file to the build or fix the name or signature so the declaration and the definition match.',
    tags: 'linker unresolved external',
  },
  {
    id: 'err-nomatch',
    group: 'errors',
    title: 'no matching function for call to ...',
    body: 'No function with that name accepts the arguments you gave. The compiler lists the candidates and what it rejected; compare their parameter types with yours, including const and references.',
  },
  {
    id: 'err-conversion',
    group: 'errors',
    title: "invalid conversion from 'int' to 'int*'",
    body: 'An integer was used where a pointer is needed, or the other way around. Usually a missing & (address-of) or * (dereference).',
    code: 'int x = 5;\nint* p = x;   // error\nint* q = &x;  // ok',
  },
  {
    id: 'err-return',
    group: 'errors',
    title: 'control reaches end of non-void function',
    body: 'A function promises a value but some path ends without a return. Flowing off the end of a function that should return a value is undefined behaviour.',
  },
  {
    id: 'err-lvalue',
    group: 'errors',
    title: 'cannot bind non-const lvalue reference to an rvalue',
    body: 'A non-const reference parameter needs a real variable. A temporary (like the result of a calculation) cannot be changed, so take the parameter by const reference or by value.',
  },
  {
    id: 'err-narrowing',
    group: 'errors',
    title: 'narrowing conversion',
    body: 'Curly-brace initialisation refuses conversions that could lose information, such as double to int. Use an explicit cast if you mean it.',
    code: 'int n{3.7};              // error\nint m = static_cast<int>(3.7);',
  },
  {
    id: 'err-segv',
    group: 'errors',
    title: 'segmentation fault (at run time)',
    body: 'The program touched memory it does not own: a null or dangling pointer, an index far outside an array, or a stack that ran out from endless recursion. Run the memory tracer on a small version to see which pointer goes wrong.',
    tags: 'crash access violation',
  },
  {
    id: 'err-uninit',
    group: 'errors',
    title: 'uninitialized variable',
    body: 'A local variable of a basic type holds garbage until you set it. Reading it is undefined behaviour and may "work" on one run and fail on another. Give every variable a value where it is declared.',
  },
  {
    id: 'err-redefinition',
    group: 'errors',
    title: 'redefinition / multiple definition',
    body: 'The same name was defined twice. In headers, protect against double inclusion with #pragma once or include guards, and put function bodies in .cpp files (or mark them inline).',
  },
];

export const MATLAB_CARDS: readonly RefCard[] = [
  {
    id: 'm-matrix',
    group: 'matlab',
    title: 'Making matrices',
    body: 'Square brackets build a matrix. Spaces or commas separate columns, semicolons start a new row. A semicolon at the end of a line hides the output.',
    code: 'A = [1 2 3; 4 5 6];\nB = zeros(2, 3);\nI = eye(3);\nC = ones(2);',
  },
  {
    id: 'm-colon',
    group: 'matlab',
    title: 'The colon and linspace',
    body: 'start:step:stop counts with a step (stop is included only if it lands on it); linspace gives an exact number of evenly spaced points including both ends.',
    code: 't = 0:0.1:1;      % 11 points\nx = linspace(0, 1, 5);',
  },
  {
    id: 'm-index',
    group: 'matlab',
    title: 'Indexing starts at 1',
    body: 'A(row, column), with the first element at 1, not 0. A colon means all, and end means the last. Logical indexing picks the elements where a test is true.',
    code: 'A(2, 3)\nA(:, 1)        % first column\nA(end, :)      % last row\nA(A > 3)       % elements above 3',
  },
  {
    id: 'm-elementwise',
    group: 'matlab',
    title: 'Matrix and element-wise operators',
    body: 'The plain operators do matrix algebra. A dot in front makes the operation act element by element. Forgetting the dot is the most common MATLAB mistake.',
    code: "A * B     % matrix product\nA .* B    % element-wise\nA .^ 2    % square each element\nA'        % transpose",
  },
  {
    id: 'm-solve',
    group: 'matlab',
    title: 'Solving linear systems',
    body: 'A\\b solves A x = b by a stable method; prefer it to inv(A)*b. det, inv, rank, eig and norm do what their names say.',
    code: 'x = A \\ b;\n[V, D] = eig(A);',
  },
  {
    id: 'm-size',
    group: 'matlab',
    title: 'size, length, numel',
    body: 'size gives the rows and columns, numel the total count, length the largest dimension.',
    code: '[r, c] = size(A);\nn = numel(A);',
  },
  {
    id: 'm-sum',
    group: 'matlab',
    title: 'sum, cumsum, prod, mean',
    body: 'These work down each column of a matrix and along a vector. Pass a second argument to choose the dimension: sum(A, 2) sums along each row.',
    code: 'sum(A)\ncumsum(v)\nmean(A, 2)',
  },
  {
    id: 'm-minmax',
    group: 'matlab',
    title: 'max, min, find, sort',
    body: 'max and min can return the position as a second output. find returns the indices where a test is true. sort can return the permutation.',
    code: "[m, i] = max(v);\nk = find(v > 2);\n[s, p] = sort(v, 'descend');",
  },
  {
    id: 'm-for',
    group: 'matlab',
    title: 'for and while loops',
    body: 'A for loop runs over the columns of the list it is given. end closes every block. Vectorised code (no loop) is usually shorter and faster.',
    code: 'for k = 1:5\n  total = total + k;\nend\nwhile err > tol\n  err = err / 2;\nend',
  },
  {
    id: 'm-if',
    group: 'matlab',
    title: 'if, elseif, else',
    body: 'Conditions use == and ~= (not !=), and & and | for element-wise logic, && and || for single values with early exit.',
    code: 'if x > 0 && y ~= 0\n  z = x / y;\nelseif x == 0\n  z = 0;\nelse\n  z = -1;\nend',
  },
  {
    id: 'm-function',
    group: 'matlab',
    title: 'Functions and anonymous functions',
    body: 'A function lives in its own file named after it, or at the end of a script. An anonymous function is a quick one-liner stored in a variable with @.',
    code: 'function [s, p] = sp(a, b)\n  s = a + b;\n  p = a * b;\nend\nf = @(x) x.^2 - 2;\nf(3)',
  },
  {
    id: 'm-print',
    group: 'matlab',
    title: 'fprintf and disp',
    body: 'fprintf prints formatted text like C printf, and does not add a new line unless you write \\n. disp prints a value.',
    code: "fprintf('x = %6.3f\\n', x);\ndisp(A)",
  },
  {
    id: 'm-plot',
    group: 'matlab',
    title: 'Plotting',
    body: 'plot draws a line from x and y vectors. hold on keeps the old curves. Label every axis.',
    code: "plot(t, y, '-o');\nxlabel('t (s)'); ylabel('y');\ngrid on; legend('data');",
  },
  {
    id: 'm-poly',
    group: 'matlab',
    title: 'Polynomials: polyfit, polyval, roots',
    body: 'Coefficients run from the highest power down. polyfit fits a polynomial of a given degree to data by least squares.',
    code: 'p = polyfit(x, y, 2);\nyy = polyval(p, xx);\nr = roots([1 -3 2]);',
  },
  {
    id: 'm-fzero',
    group: 'matlab',
    title: 'fzero, fminsearch, integral',
    body: 'fzero finds where a function crosses zero near a guess or inside a bracket. fminsearch finds a minimum. integral integrates a function handle between two limits.',
    code: 'x0 = fzero(@(x) cos(x) - x, [0 1]);\nA = integral(@(x) x.^2, 0, 1);',
  },
  {
    id: 'm-ode',
    group: 'matlab',
    title: 'ode45',
    body: "Solves a first-order system y' = f(t, y). Higher-order equations are rewritten as first-order systems. The function must return a column vector.",
    code: '[t, y] = ode45(@(t, y) -2*y, [0 5], 1);',
  },
  {
    id: 'm-interp',
    group: 'matlab',
    title: 'interp1 and trapz',
    body: 'interp1 estimates values between data points (linear by default). trapz integrates sampled data with the trapezoid rule.',
    code: 'yi = interp1(x, y, xi);\narea = trapz(x, y);',
  },
  {
    id: 'm-strings',
    group: 'matlab',
    title: 'Strings, cells and structs',
    body: 'Double quotes make a string, single quotes a character array. Curly braces make a cell array that can hold different types. A struct groups named fields.',
    code: "s = \"hello\";\nc = {1, 'two', [3 4]};\nst.name = 'bar';",
  },
  {
    id: 'm-debug',
    group: 'matlab',
    title: 'Debugging habits',
    body: 'Remove a semicolon to see a value. Check size() when an operation complains about dimensions. clear and clc start a script from a clean state; running the script from the top often reveals leftovers that hid a bug.',
    tags: 'error dimensions must agree',
  },
];

export const ALL_CARDS: readonly RefCard[] = [...TYPE_CARDS, ...ESCAPE_CARDS, ...ERROR_CARDS, ...MATLAB_CARDS];

/** Cards matching every word of the query in the title, body, tags, or code, titles first. */
export function searchCards(cards: readonly RefCard[], query: string): RefCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...cards];
  const scored: { card: RefCard; score: number }[] = [];
  for (const card of cards) {
    const title = card.title.toLowerCase();
    const rest = `${card.body} ${card.tags ?? ''} ${card.code ?? ''}`.toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      if (title.includes(w)) score += 3;
      else if (rest.includes(w)) score += 1;
      else all = false;
    }
    if (all) scored.push({ card, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.card);
}

// ---------- trace tables ----------

export interface TraceTable {
  header: string[];
  rows: string[][];
}

/** Variable names from a comma or space separated list: identifiers only, no repeats, at most 12. */
export function traceVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) seen.add(part);
  }
  return [...seen].slice(0, 12);
}

/** An empty trace table: a column for the line number, one per variable, and the output. */
export function traceTable(
  variables: readonly string[],
  rows: number,
  labels: { line: string; output: string },
): TraceTable {
  const n = Math.max(1, Math.min(60, Math.floor(rows)));
  return {
    header: [labels.line, ...variables, labels.output],
    rows: Array.from({ length: n }, () => Array.from({ length: variables.length + 2 }, () => '')),
  };
}
