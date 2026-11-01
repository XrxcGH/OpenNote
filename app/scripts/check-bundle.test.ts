import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { failures, groups, measure, summary } from './check-bundle.ts';
import type { Budget, Manifest } from './check-bundle.ts';

const MANIFEST: Manifest = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_shared.js'], css: ['assets/index.css'] },
  '_shared.js': { file: 'assets/shared.js' },
  'src/features/palette/Palette.tsx': {
    file: 'assets/palette.js',
    src: 'src/features/palette/Palette.tsx',
    isDynamicEntry: true,
    imports: ['_shared.js', '_fuzzy.js'],
  },
  '_fuzzy.js': { file: 'assets/fuzzy.js' },
  'src/features/about/About.tsx': {
    file: 'assets/about.js',
    src: 'src/features/about/About.tsx',
    isDynamicEntry: true,
  },
};

const BUDGET: Budget = { startup: { jsKb: 1, cssKb: 1 }, lazyKb: { 'features/palette': 2 }, lazyDefaultKb: 3 };

describe('check-bundle', () => {
  it('groups start-up files and each lazy chunk without what start-up loads', () => {
    expect(groups(MANIFEST, BUDGET)).toEqual([
      { name: 'start-up JavaScript', files: ['assets/index.js', 'assets/shared.js'], limitKb: 1 },
      { name: 'start-up CSS', files: ['assets/index.css'], limitKb: 1 },
      { name: 'src/features/palette/Palette.tsx', files: ['assets/palette.js', 'assets/fuzzy.js'], limitKb: 2 },
      { name: 'src/features/about/About.tsx', files: ['assets/about.js'], limitKb: 3 },
    ]);
  });

  it('counts a group that loads after another one without what that one loads', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/index.js', isEntry: true },
      'src/features/page/PageBody.tsx': {
        file: 'assets/page.js',
        src: 'src/features/page/PageBody.tsx',
        isDynamicEntry: true,
        imports: ['_editor.js'],
      },
      '_editor.js': { file: 'assets/editor.js' },
      'src/features/page/history/chunk.ts': {
        file: 'assets/history.js',
        src: 'src/features/page/history/chunk.ts',
        isDynamicEntry: true,
        imports: ['_editor.js', '_diff.js'],
      },
      '_diff.js': { file: 'assets/diff.js' },
      'src/features/palette/Palette.tsx': {
        file: 'assets/palette.js',
        src: 'src/features/palette/Palette.tsx',
        isDynamicEntry: true,
        imports: ['_editor.js'],
      },
    };
    const budget: Budget = { ...BUDGET, after: { within: 'features/page/', entry: 'features/page/PageBody' } };
    expect(groups(manifest, budget).slice(2)).toEqual([
      { name: 'src/features/page/PageBody.tsx', files: ['assets/page.js', 'assets/editor.js'], limitKb: 3 },
      { name: 'src/features/page/history/chunk.ts', files: ['assets/history.js', 'assets/diff.js'], limitKb: 3 },
      { name: 'src/features/palette/Palette.tsx', files: ['assets/palette.js', 'assets/editor.js'], limitKb: 2 },
    ]);
  });

  it('measures gzipped sizes and reports groups over their limit', () => {
    const dist = mkdtempSync(join(tmpdir(), 'bundle-'));
    writeFileSync(join(dist, 'small.js'), 'export {};');
    writeFileSync(join(dist, 'big.js'), randomBytes(4000));
    const small = measure(dist, { name: 'small', files: ['small.js'], limitKb: 1 });
    const big = measure(dist, { name: 'big', files: ['big.js'], limitKb: 1 });
    expect(small.bytes).toBeLessThan(1024);
    expect(failures([small, big])).toEqual([`big is ${(big.bytes / 1024).toFixed(1)} KB gzipped; its limit is 1 KB.`]);
  });

  it('shows the change from a baseline', () => {
    const now = [{ name: 'start-up JavaScript', files: [], limitKb: 125, bytes: 2048 }];
    const before = [{ name: 'start-up JavaScript', files: [], limitKb: 125, bytes: 1024 }];
    expect(summary(now, before)).toContain('| start-up JavaScript | 2.0 | 125 | +1.0 |');
    expect(summary(now, null)).toContain('no baseline');
  });
});

describe('check-bundle after rules', () => {
  it('takes several after rules, one for each kit window, each leaving out only its own window', () => {
    const lazy = (src: string, file: string, imports: string[]) => ({
      file,
      src,
      isDynamicEntry: true,
      imports,
    });
    const manifest: Manifest = {
      'index.html': { file: 'assets/index.js', isEntry: true },
      'src/features/engineering/aero/ui/AeroKit.tsx': lazy('src/features/engineering/aero/ui/AeroKit.tsx', 'a.js', [
        '_words-a.js',
      ]),
      'src/features/engineering/aero/wing/tool.ts': lazy('src/features/engineering/aero/wing/tool.ts', 'wing.js', [
        '_words-a.js',
      ]),
      'src/features/engineering/thermo/ui/ThermoKit.tsx': lazy(
        'src/features/engineering/thermo/ui/ThermoKit.tsx',
        't.js',
        ['_words-t.js'],
      ),
      'src/features/engineering/thermo/steam/tool.ts': lazy(
        'src/features/engineering/thermo/steam/tool.ts',
        'steam.js',
        ['_words-t.js', '_words-a.js'],
      ),
      '_words-a.js': { file: 'assets/words-a.js' },
      '_words-t.js': { file: 'assets/words-t.js' },
    };
    const budget: Budget = {
      ...BUDGET,
      after: [
        { within: 'engineering/aero/', entry: 'engineering/aero/ui/AeroKit' },
        { within: 'engineering/thermo/', entry: 'engineering/thermo/ui/ThermoKit' },
      ],
    };
    const files = Object.fromEntries(
      groups(manifest, budget)
        .slice(2)
        .map((g) => [g.name.split('/').slice(-2).join('/'), g.files]),
    );
    expect(files['ui/AeroKit.tsx']).toEqual(['a.js', 'assets/words-a.js']);
    expect(files['wing/tool.ts']).toEqual(['wing.js']);
    expect(files['ui/ThermoKit.tsx']).toEqual(['t.js', 'assets/words-t.js']);
    // The steam tool follows the thermo window only, so the aero words still count against it.
    expect(files['steam/tool.ts']).toEqual(['steam.js', 'assets/words-a.js']);
  });
});
