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
