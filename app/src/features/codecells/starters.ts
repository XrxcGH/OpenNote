// The example code a new cell starts with. It is program text, not interface text, so it lives here and loads
// with the cell, not in the string catalog (where braces would read as message placeholders).
import type { CodeLanguage } from './model';

const EXAMPLES = {
  python: `# Newton’s method for the square root of 2
x = 1.0
for step in range(6):
    x = x - (x * x - 2) / (2 * x)
    print(step, x)
`,
  javascript: `// Newton’s method for the square root of 2
let x = 1;
const next = (v) => v - (v * v - 2) / (2 * v);
for (let step = 0; step < 6; step++) console.log(step, (x = next(x)));
`,
  typescript: `// Newton’s method for the square root of 2
const next = (v: number): number => v - (v * v - 2) / (2 * v);
let x = 1;
for (let step = 0; step < 6; step++) console.log(step, (x = next(x)));
`,
  sql: `-- The squares of 1 to 5, and their sum
WITH n(i) AS (VALUES (1), (2), (3), (4), (5))
SELECT i, i * i AS square, SUM(i * i) OVER () AS total FROM n;
`,
  lua: `-- Newton’s method for the square root of 2
local x = 1.0
for step = 0, 5 do
  x = x - (x * x - 2) / (2 * x)
  print(step, x)
end
`,
  c: `// Newton’s method for the square root of 2
#include <stdio.h>

int main(void)
{
    double x = 1.0;
    for (int step = 0; step < 6; step++) {
        x = x - (x * x - 2) / (2 * x);
        printf("%d %.10f\\n", step, x);
    }
    return 0;
}
`,
  cpp: `// Newton’s method for the square root of 2
#include <iostream>

int main()
{
    double x = 1.0;
    for (int step = 0; step < 6; step++) {
        x = x - (x * x - 2) / (2 * x);
        std::cout << step << " " << x << "\\n";
    }
    return 0;
}
`,
} as const satisfies Record<CodeLanguage, string>;

/** The example for a language. */
export function starterOf(language: CodeLanguage): string {
  return EXAMPLES[language];
}
