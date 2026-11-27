// @vitest-environment node
// GitHub Actions expressions have no arithmetic: `${{ matrix.shard * 50000 }}` is a syntax error that makes the whole
// workflow file invalid. GitHub then starts a failed run with no jobs on every push, and a schedule on the default
// branch would not run at all. This reads every workflow file and fails on an operator that expressions lack.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

describe('nightly typing gate', () => {
  it('runs perf:typing with the 16 ms gate on and reports its failure', () => {
    const text = readFileSync(join(DIR, 'nightly.yml'), 'utf8');
    const job = text.slice(text.indexOf('  perf-typing-gate:'), text.indexOf('  e2e-full:'));
    expect(job).toContain("OPENNOTE_TYPING_GATE: '1'");
    expect(job).toContain('npm run perf:typing');
    expect(text).toMatch(/needs: \[[^\]]*perf-typing-gate/);
  });
});

describe('nightly E2E specs', () => {
  const E2E = join(import.meta.dirname, '..', '..', 'tests', 'e2e');

  /** Every spec file under tests/e2e, as a path from it with forward slashes. */
  function specs(dir = E2E, base = ''): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? specs(join(dir, entry.name), `${base}${entry.name}/`)
        : entry.name.endsWith('.spec.ts')
          ? [`${base}${entry.name}`]
          : [],
    );
  }

  const run = () => {
    const text = readFileSync(join(DIR, 'nightly.yml'), 'utf8');
    return text.slice(text.indexOf('  e2e-full:'), text.indexOf('  soak:'));
  };

  it('runs with node --test only the specs that drive the real app', () => {
    // The loop runs each spec with node --test. A web-build spec (Playwright) cannot load there: the nightly on main
    // failed with "Cannot find module .../helpers". Those folders have a playwright.config.ts, and the loop skips
    // them.
    expect(run()).toContain('playwright.config.ts');
    const realApp = specs().filter(
      (spec) => !existsSync(join(E2E, ...spec.split('/').slice(0, -1), 'playwright.config.ts')),
    );
    expect(realApp.length).toBeGreaterThan(20);
    for (const spec of realApp) {
      // What the loop runs imports the harness. A spec that does not is a web-build spec in a folder with no config.
      expect(readFileSync(join(E2E, ...spec.split('/')), 'utf8'), spec).toMatch(/harness\.ts'/);
    }
  });

  it('keeps the web-build specs in a CI job', () => {
    const ci = readFileSync(join(DIR, 'ci.yml'), 'utf8');
    expect(ci).toContain('npm run test:e2e:text');
  });
});
