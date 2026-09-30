// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

const require = createRequire(import.meta.url);

// The package fonts.ts imports for each font token. CSS matches @font-face rules by exact family name,
// so a token that starts with any other name falls back to a system font and the bundled files never load.
const PACKAGES = {
  ui: '@fontsource-variable/atkinson-hyperlegible-next',
  reading: '@fontsource-variable/literata',
  mono: '@fontsource/atkinson-hyperlegible-mono',
} as const;
const ROLES = Object.keys(PACKAGES) as (keyof typeof PACKAGES)[];

/** The families a package registers, read from the same CSS file the app imports. */
function registeredFamilies(pkg: string): string[] {
  const css = readFileSync(require.resolve(pkg), 'utf8');
  const names = [...css.matchAll(/font-family\s*:\s*['"]?([^'";}]+?)['"]?\s*[;}]/g)].map((match) => match[1]);
  return [...new Set(names)];
}

/** The first family in a CSS font stack, without quotes. */
function firstFamily(stack: string): string {
  return stack
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

describe('bundled fonts', () => {
  it('covers every package fonts.ts imports', () => {
    const source = readFileSync(require.resolve('./fonts.ts'), 'utf8');
    const imported = [...source.matchAll(/^import '([^']+)';/gm)].map((match) => match[1]);
    expect(imported.sort()).toEqual(Object.values(PACKAGES).sort());
  });

  it.each(ROLES)('font.%s starts with the family its package registers', (role) => {
    const families = registeredFamilies(PACKAGES[role]);
    expect(families.length).toBeGreaterThan(0);
    expect(families).toContain(firstFamily(tokens.font[role]));
  });
});
