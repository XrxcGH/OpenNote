// The example programs come out whole: the message formatter would read a brace as a placeholder, so C and C++ live
// in starters.ts. Each example prints the Newton iterations for the square root of 2 (hand-worked: 1.5, 1.41666...).
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './model';
import { starterOf } from './starters';

describe('the code cell starters', () => {
  it.each(LANGUAGES)('%s has a starter with no gaps from the formatter', (language) => {
    const text = starterOf(language);
    expect(text).not.toContain('undefined');
    expect(text.length).toBeGreaterThan(20);
  });

  it('keeps the braces and the escaped newline of the C and C++ examples', () => {
    expect(starterOf('c')).toContain('int main(void)');
    expect(starterOf('c')).toContain('printf("%d %.10f\n", step, x);');
    expect(starterOf('cpp')).toContain('std::cout << step');
    expect(starterOf('cpp')).toContain('{');
  });
});
