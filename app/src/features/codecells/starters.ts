// The example code a new cell starts with. Most are in the string catalog; C and C++ are here, because their braces
// would read as message placeholders there. The example is program text, not interface text.
import { t } from '../../strings/t';
import type { CodeLanguage } from './model';

const C_LIKE = {
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
} as const;

/** The example for a language. */
export function starterOf(language: CodeLanguage): string {
  return language === 'c' || language === 'cpp' ? C_LIKE[language] : t(`codeCells.starter.${language}`);
}
