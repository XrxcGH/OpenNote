// The docs match the code: every ADR number is used once and listed in the index, the feature list covers every
// section of FEATURES.md and its pictures exist, and the status pages no longer call built features unbuilt.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { regenerate, readScreens, SCREEN_CATEGORIES } from '../../../docs/tools/featureList';

const docs = join(import.meta.dirname, '..', '..', '..', 'docs');
function markdown(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdown(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  );
}
const read = (...parts: string[]) => readFileSync(join(docs, ...parts), 'utf8');

describe('architecture decision records', () => {
  const files = readdirSync(join(docs, 'adr')).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));
  const index = read('adr', 'README.md');

  it('uses each number once', () => {
    const numbers = files.map((f) => f.slice(0, 4));
    expect(numbers.filter((n, i) => numbers.indexOf(n) !== i)).toEqual([]);
  });

  it('lists every record in the index and repeats its number in its title', () => {
    for (const file of files) {
      expect(index, file).toContain(`](${file})`);
      expect(read('adr', file).split('\n')[0], file).toMatch(new RegExp(`^# ADR ${file.slice(0, 4)}: `));
    }
  });
});

describe('ADR links', () => {
  it('show the number of the record they point at', () => {
    const roots = [join(docs, '..', 'README.md'), ...markdown(docs)];
    const wrong = roots.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\[ADR (\d{4})\]\([^)]*?(\d{4})-[^)]*\.md\)/g)]
        .filter((m) => m[1] !== m[2])
        .map((m) => `${file.slice(docs.length)}: ${m[0]}`),
    );
    expect(wrong).toEqual([]);
  });
});

describe('feature list', () => {
  const list = read('FEATURE-LIST.md');

  it('has a section for every section of FEATURES.md that lists features', () => {
    const headings = read('FEATURES.md')
      .split('\n')
      .filter((l) => l.startsWith('## ') && !/Contents|How to read the status/.test(l))
      .map((l) => l.slice(3).trim());
    for (const heading of headings) expect(list, heading).toContain(`## ${heading}`);
  });

  it('is what `npm run docs:features` makes from FEATURES.md, so it cannot go stale', () => {
    expect(list).toBe(regenerate());
  });

  it('has a picture, in both themes, for every category of screen', () => {
    const screens = readScreens();
    for (const category of SCREEN_CATEGORIES)
      expect(
        screens.some((s) => s.category === category),
        category,
      ).toBe(true);
    for (const s of screens) {
      expect(existsSync(join(docs, 'screens', `${s.name}-light.png`)), s.name).toBe(true);
      expect(existsSync(join(docs, 'screens', `${s.name}-dark.png`)), s.name).toBe(true);
    }
  });

  it('points at pictures that exist', () => {
    const pictures = [...list.matchAll(/\]\((screens\/[^)]+\.png)\)/g)].map((m) => m[1]!);
    expect(pictures.length).toBeGreaterThan(20);
    for (const picture of pictures) expect(existsSync(join(docs, picture)), picture).toBe(true);
  });

  it('is linked from the README and the help index', () => {
    expect(readFileSync(join(docs, '..', 'README.md'), 'utf8')).toContain('docs/FEATURE-LIST.md');
    expect(read('help', 'README.md')).toContain('FEATURE-LIST.md');
  });
});

describe('status pages', () => {
  it('do not call built features unbuilt', () => {
    const features = read('FEATURES.md');
    for (const stale of ['A narrated video is not built yet', 'Sway frames in moment distribution are not built yet']) {
      expect(features).not.toContain(stale);
    }
    const dev = read('DEVELOPMENT.md');
    expect(dev).not.toMatch(/Not built: The pen library/);
    expect(dev).not.toMatch(/Not built: The whisper\.cpp/);
    expect(dev).not.toContain('Layers (a format decision)');
    expect(readFileSync(join(docs, '..', 'README.md'), 'utf8')).not.toContain('Not built yet in beta');
    expect(read('help', 'phone-scan.md')).not.toContain("isn't built yet");
  });

  it('describe ink layers, groups and links in the format spec', () => {
    const spec = read('format', 'README.md');
    expect(spec).not.toContain('The `base` layer has no entry');
    for (const key of ['`groups`', '`inkLayers.order`', '`inkLayers.assign`', '`inkLinks`'])
      expect(spec).toContain(key);
  });
});
