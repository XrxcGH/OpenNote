// @vitest-environment node
// GitHub Actions expressions have no arithmetic: `${{ matrix.shard * 50000 }}` is a syntax error that makes the whole
// workflow file invalid. GitHub then starts a failed run with no jobs on every push, and a schedule on the default
// branch would not run at all. This reads every workflow file and fails on an operator that expressions lack.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', '..', '.github', 'workflows');

/** The text inside each `${{ }}`, with quoted strings emptied and the `.*` object filter removed. */
export function expressionsOf(text: string): string[] {
  return [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) =>
    match[1]!.replace(/'(?:[^']|'')*'/g, "''").replace(/\.\*/g, '.'),
  );
}

/** The expressions that use an operator GitHub does not have: * / % or +. */
export const withArithmetic = (text: string): string[] =>
  expressionsOf(text)
    .filter((expression) => /[*/%+]/.test(expression))
    .map((expression) => expression.trim());

describe('workflow expressions', () => {
  it('finds arithmetic, and leaves strings and object filters alone', () => {
    expect(withArithmetic('x: ${{ matrix.shard * 50000 }}')).toEqual(['matrix.shard * 50000']);
    expect(withArithmetic('x: ${{ (matrix.shard + 1) * 5 }}')).toHaveLength(1);
    expect(withArithmetic("x: ${{ contains(needs.*.result, 'a/b + c') }}")).toEqual([]);
    expect(withArithmetic('x: ${{ always() && github.ref == matrix.ref }}')).toEqual([]);
  });

  for (const file of readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name))) {
    it(`${file} has no arithmetic inside \${{ }}`, () => {
      expect(withArithmetic(readFileSync(join(DIR, file), 'utf8'))).toEqual([]);
    });
  }
});
