// The docs match the code: every ADR number is used once and listed in the index, the feature list covers every
// section of FEATURES.md in a category and its pictures exist, and the status pages no longer call built features unbuilt.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  regenerate,
  readScreens,
  SCREEN_CATEGORIES,
  sectionsOf,
  unplacedSections,
} from '../../../docs/tools/featureList';
import { balanced, entryName, firstSentence } from '../../../docs/tools/featureRows';

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
  const lines = list.split('\n');

  it('puts every section of FEATURES.md in a category, and has a heading for every category', () => {
    expect(unplacedSections(read('FEATURES.md'))).toEqual([]);
    for (const category of CATEGORIES) expect(list, category).toContain(`## ${category}`);
  });

  it('closes every parenthesis, so no sentence was cut inside one', () => {
    // Pictures and their captions are left out: a picture's alt text is its caption.
    const text = lines.filter((line) => !/^(!\[|<!--|\*\*[a-z0-9-]+\.\*\*)/.test(line));
    expect(text.filter((line) => !balanced(line))).toEqual([]);
    expect(balanced('air resistance (from mass')).toBe(false);
    expect(firstSentence('A window (0.00120 has 3. 1200 has 2) that counts. More words here.')).toBe(
      'A window (0.00120 has 3. 1200 has 2) that counts',
    );
  });

  it('gives every command, tab, and bullet a sentence', () => {
    expect(lines.filter((line) => /^- \*\*[^*]+\.\*\*( Not in the palette\.)?\s*$/.test(line))).toEqual([]);
    // A command row has its name, its sentence, and its keys.
    expect(lines.filter((line) => /^\| [^|]+ \|\s*\|/.test(line) && !line.startsWith('| ---'))).toEqual([]);
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

  it('lists every picture of screens.json on the Screens page', () => {
    const page = read('screens', 'README.md');
    for (const s of readScreens()) expect(page, s.name).toContain(`[${s.name}](${s.name}-light.png)`);
  });

  it('shows each picture with the caption of screens.json on the Screens page', () => {
    const page = read('screens', 'README.md');
    const lines = page.split(/\r?\n/);
    for (const s of readScreens())
      expect(
        lines.some((line) => line.startsWith(`- [${s.name}](`) && line.endsWith(`: ${s.caption}`)),
        s.name,
      ).toBe(true);
  });

  it('says in the docs index how many pictures and screens there are', () => {
    const screens = readScreens();
    const pngs = readdirSync(join(docs, 'screens')).filter(
      (f) => f.endsWith('.png') && f.includes('-light.png'),
    ).length;
    const all = readdirSync(join(docs, 'screens')).filter((f) => f.endsWith('.png') && /-(light|dark)\.png$/.test(f));
    expect(pngs).toBe(screens.length);
    expect(all.length).toBe(screens.length * 2);
    expect(read('README.md')).toContain(
      `${all.length} pictures of ${screens.length} screens, each in light and in dark`,
    );
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

describe('feature list rows', () => {
  it('lists every table row of FEATURES.md, so a row after a paragraph is not dropped silently', () => {
    const rows: string[] = [];
    let section = '';
    const source = read('FEATURES.md').split(/\r?\n/);
    const rule = /^\|?[\s:|-]+\|?$/;
    source.forEach((line, at) => {
      const heading = /^## (.+)$/.exec(line);
      if (heading) section = heading[1]!.trim();
      // A table row starts with a bar. The header is the row above the rule, and the rule has only dashes.
      if (!line.startsWith('|') || rule.test(line) || rule.test(source[at + 1] ?? '')) return;
      if (/^(Contents|How to read the status|Screens)$/.test(section)) return;
      rows.push(
        line
          .split('|')[1]!
          .trim()
          .replace(/^\*\*|\*\*$/g, ''),
      );
    });
    expect(rows.length).toBeGreaterThan(50);
    // The generator's first stage keeps one entry for each row. The tool windows are then named from the registry.
    const kept = new Set(sectionsOf(read('FEATURES.md')).flatMap((one) => one.entries.map(entryName)));
    expect(rows.filter((name) => name && !kept.has(name))).toEqual([]);
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

// The two help index tests are guards. They also pass without new work, so they do not prove it.
describe('help index', () => {
  it('links every help page', () => {
    const index = read('help', 'README.md');
    const pages = readdirSync(join(docs, 'help')).filter((f) => f.endsWith('.md') && f !== 'README.md');
    expect(pages.filter((f) => !index.includes(`](${f})`))).toEqual([]);
  });

  it('links only pages that exist', () => {
    const index = read('help', 'README.md');
    const dead = [...index.matchAll(/\]\(([a-z0-9-]+\.md)\)/g)]
      .map((m) => m[1])
      .filter((f) => !existsSync(join(docs, 'help', f)));
    expect(dead).toEqual([]);
  });
});

describe('ADR index status', () => {
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const firstWord = (t: string) => /^- Status: (\w+)/m.exec(t)?.[1];
  const records = () =>
    readdirSync(join(docs, 'adr')).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));

  it('shows the same first status word in the index and in the record file, both ways', () => {
    const index = read('adr', 'README.md');
    const wrong = records().filter((f) => {
      const row = new RegExp(`\\]\\(${escape(f)}\\) *\\|[^|\\n]*\\| *(\\w+)`).exec(index);
      return !row || row[1] !== firstWord(read('adr', f));
    });
    expect(wrong).toEqual([]);
  });

  it('escapes dots in a file name', () => {
    expect(new RegExp(escape('a.md')).test('axmd')).toBe(false);
  });
});
