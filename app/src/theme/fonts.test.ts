// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { standInFor } from './fonts';
import { tokens } from './tokens';

const require = createRequire(import.meta.url);

// The package fonts.ts imports for each font token. CSS matches @font-face rules by exact family name,
// so a token that starts with any other name falls back to a system font and the bundled files never load.
const PACKAGES = {
  ui: './fonts/opennote-sans.css',
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

describe('metric stand-in fonts', () => {
  const dir = join(import.meta.dirname, 'fonts');
  const FAMILIES = ['carlito', 'caladea'] as const;
  const notices = readFileSync(join(import.meta.dirname, '..', '..', '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const budget = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'bundle-budget.json'), 'utf8')) as {
    bundledFontsKb: Record<(typeof FAMILIES)[number], number>;
  };

  it.each(FAMILIES)('%s has its license text and a notice line', (family) => {
    const license = readFileSync(join(dir, `${family}-OFL.txt`), 'utf8');
    expect(license).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(license).toMatch(new RegExp(`The ${family} Project Authors`, 'i'));
    expect(notices).toMatch(new RegExp(`^- ${family}[ ,].*Copyright`, 'im'));
  });

  it.each(FAMILIES)('%s has four faces in Latin and Latin Extended', (family) => {
    const files = readdirSync(dir).filter((name) => name.startsWith(`${family}-latin`) && name.endsWith('.woff2'));
    expect(files.sort()).toEqual(
      ['latin', 'latin-ext']
        .flatMap((subset) =>
          ['400', '700'].flatMap((weight) =>
            ['italic', 'normal'].map((style) => `${family}-${subset}-${weight}-${style}.woff2`),
          ),
        )
        .sort(),
    );
  });

  it.each(FAMILIES)('%s stays under its byte budget', (family) => {
    const bytes = readdirSync(dir)
      .filter((name) => name.startsWith(`${family}-latin`) && name.endsWith('.woff2'))
      .reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
    expect(bytes).toBeLessThanOrEqual(budget.bundledFontsKb[family] * 1024);
  });

  it.each(FAMILIES)('%s style rules put local() before the bundled file', (family) => {
    const css = readFileSync(join(dir, `${family}.css`), 'utf8');
    const rules = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    expect(rules).toHaveLength(8);
    for (const rule of rules) expect(rule.indexOf('local(')).toBeLessThan(rule.indexOf('url('));
  });

  it('is never imported at start-up', () => {
    const source = readFileSync(join(import.meta.dirname, 'fonts.ts'), 'utf8');
    expect(source).not.toMatch(/^import '[^']*(carlito|caladea)/im);
    const files = ['../main.tsx', '../index.css'].map((rel) => join(import.meta.dirname, rel));
    for (const file of files.filter((path) => existsSync(path))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/carlito|caladea/i);
    }
  });

  it('maps Calibri to Carlito and Cambria to Caladea, and nothing else', () => {
    expect(standInFor('Calibri')).toBe('Carlito');
    expect(standInFor(' cambria ')).toBe('Caladea');
    expect(standInFor('Arial')).toBeUndefined();
    expect(standInFor('Aptos')).toBeUndefined();
  });
});
