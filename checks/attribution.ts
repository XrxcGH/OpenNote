// Asset attribution: every bundled non-code file (picture, font, sound, model, binary seed) and every vendored
// third-party crate needs a row in docs/ATTRIBUTION.md that names its author, source, and license. The check keeps
// the table honest in both directions: a file with no row fails, and so does a row that matches no file.
// `node checks/attribution.ts` prints the gaps. The same check runs in `npm test` (checks/test/attribution.test.ts).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from './glob.ts';

/** File types that are assets rather than code or text. A new type of asset is added here. */
const ASSET_EXTENSIONS = new Set([
  'woff',
  'woff2',
  'ttf',
  'otf',
  'ttc',
  'eot',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'icns',
  'svg',
  'tif',
  'tiff',
  'heic',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'mp4',
  'webm',
  'onnx',
  'ort',
  'gguf',
  'safetensors',
  'bin',
  'dat',
  'wasm',
  'pdf',
  'dic',
  'aff',
  'traineddata',
]);

export interface Row {
  glob: string;
  author: string;
  source: string;
  license: string;
}

export interface Gaps {
  /** Asset files that no row covers. */
  uncovered: string[];
  /** Rows whose path matches no tracked file. */
  stale: string[];
  /** Rows with an empty author, source, or license. */
  incomplete: string[];
  /** Vendored crates (crates/third_party/NAME) with no license file or no row. */
  vendored: string[];
  /** Bundled npm packages (fonts) with no `npm:` row, or whose copyright line is missing from THIRD_PARTY_NOTICES.md. */
  packages: string[];
}

/** npm packages that ship font or picture files into the app. A package with this prefix needs an `npm:` row. */
const ASSET_PACKAGES = /^@fontsource(-variable)?\//;

/** What the notices file and the installed packages say, so the check can compare them. Empty when not given. */
export interface PackageFacts {
  /** Names in package.json dependencies and devDependencies. */
  dependencies: string[];
  /** The text of THIRD_PARTY_NOTICES.md. */
  notices: string;
  /** The first copyright line of each installed package's LICENSE file, by package. Missing when not installed. */
  copyrights: Record<string, string | undefined>;
}

/** The table rows of the attribution file: a backticked path, an author, a source, and a license. */
export function parseRows(markdown: string): Row[] {
  const rows: Row[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const match = /^`([^`]+)`$/.exec(cells[0]);
    if (match) rows.push({ glob: match[1], author: cells[1], source: cells[2], license: cells[3] });
  }
  return rows;
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Compares the tracked files with the table. `files` use forward slashes, relative to the repository root. */
export function findGaps(files: string[], markdown: string, facts?: PackageFacts): Gaps {
  const allRows = parseRows(markdown);
  const rows = allRows.filter((row) => !row.glob.startsWith('npm:'));
  const assets = files.filter((file) => ASSET_EXTENSIONS.has(extension(file)));
  const uncovered = assets.filter((file) => !rows.some((row) => globToRegExp(row.glob).test(file)));
  const stale = rows.filter((row) => !files.some((file) => globToRegExp(row.glob).test(file))).map((row) => row.glob);
  const incomplete = rows.filter((r) => !r.author || !r.source || !r.license).map((r) => r.glob);
  const vendored: string[] = [];
  const crates = new Set(
    files
      .map((f) => /^crates\/third_party\/([^/]+)\//.exec(f)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  for (const name of crates) {
    const prefix = `crates/third_party/${name}/`;
    const hasLicense = files.some(
      (f) => f.startsWith(prefix) && /^(LICENSE|COPYING|NOTICE)/i.test(f.slice(prefix.length)),
    );
    const hasRow = rows.some((row) => row.glob.startsWith(prefix));
    if (!hasLicense) vendored.push(`${prefix} has no LICENSE file`);
    if (!hasRow) vendored.push(`${prefix} has no row in docs/ATTRIBUTION.md`);
  }
  const incompleteNpm = allRows.filter((r) => r.glob.startsWith('npm:') && (!r.author || !r.source || !r.license));
  incomplete.push(...incompleteNpm.map((r) => r.glob));
  const packages: string[] = [];
  if (facts !== undefined) {
    const named = new Set(allRows.filter((r) => r.glob.startsWith('npm:')).map((r) => r.glob.slice(4)));
    const bundled = facts.dependencies.filter((name) => ASSET_PACKAGES.test(name));
    for (const name of bundled) {
      if (!named.has(name)) packages.push(`no row \`npm:${name}\` in docs/ATTRIBUTION.md`);
      const line = facts.copyrights[name];
      if (line !== undefined && !facts.notices.includes(line))
        packages.push(`THIRD_PARTY_NOTICES.md lacks the copyright line of ${name}: ${line}`);
    }
    for (const name of named)
      if (!facts.dependencies.includes(name))
        packages.push(`the row \`npm:${name}\` names a package that is not a dependency`);
  }
  return { uncovered, stale, incomplete, vendored, packages };
}

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export function trackedFiles(root: string): string[] {
  const listing = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing.split('\0').filter((path) => path !== '');
}

/** The package facts of a checkout. The copyright line is the first line of the package's LICENSE, up to the first file name. */
export function packageFacts(root = repoRoot()): PackageFacts {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  const copyrights: PackageFacts['copyrights'] = {};
  for (const name of dependencies.filter((n) => ASSET_PACKAGES.test(n))) {
    try {
      const text = readFileSync(join(root, 'node_modules', name, 'LICENSE'), 'utf8');
      const first = text.split(/\r?\n/)[0];
      copyrights[name] = first.split(/ \S+\.(?:ttf|otf|woff2?)\b/)[0].trim();
    } catch {
      copyrights[name] = undefined;
    }
  }
  return { dependencies, notices: readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), copyrights };
}

export function attributionGaps(root = repoRoot()): Gaps {
  return findGaps(trackedFiles(root), readFileSync(join(root, 'docs', 'ATTRIBUTION.md'), 'utf8'), packageFacts(root));
}

export function describeGaps(gaps: Gaps): string[] {
  return [
    ...gaps.uncovered.map((file) => `no row in docs/ATTRIBUTION.md covers ${file}`),
    ...gaps.stale.map((glob) => `the row for ${glob} matches no tracked file`),
    ...gaps.incomplete.map((glob) => `the row for ${glob} needs an author, source, and license`),
    ...gaps.vendored,
    ...gaps.packages,
  ];
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = describeGaps(attributionGaps());
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more`);
  console.log(
    problems.length === 0 ? 'Every asset has an attribution row.' : `${problems.length} attribution problems.`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}
