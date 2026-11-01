// A kit's words beyond start-up load with the kit's text.ts. A module that reads one of those words must reach text.ts
// through static imports, or it shows raw keys whenever it runs before the kit window. These checks scan the sources,
// because every kit test imports text.ts itself and so cannot catch a missing import.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const START = readdirSync(__dirname).filter((f) => /^kit\w+Start\.ts$/.test(f));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'strings' || name === 'node_modules' ? [] : walk(p);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [p] : [];
  });
}
const FILES = walk(SRC);
/** A source's code without its comments, which name keys and files in prose. */
const code = (src: string) => src.replace(/\/\*[^]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const text = new Map(FILES.map((f) => [f, code(readFileSync(f, 'utf8'))]));
/** Whether a file takes the translator or the words object, so it reads words itself and does not just name keys. */
const READS = /from\s*['"][./]*strings(?:\/en|\/t)?['"]/;

function resolveImport(from: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = resolve(dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
    (c) => existsSync(c) && statSync(c).isFile(),
  );
}

/** Every file reachable from `file` through static imports and re-exports (not `import()`). */
const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const EDGES = new Map<string, string[]>();
function edges(file: string): string[] {
  let e = EDGES.get(file);
  if (!e) {
    const src = text.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : '');
    e = [...src.matchAll(IMPORT)].flatMap((m) => resolveImport(file, m[1] ?? m[2]!) ?? []);
    EDGES.set(file, e);
  }
  return e;
}
const REACH = new Map<string, Set<string>>();
function reach(file: string): Set<string> {
  let r = REACH.get(file);
  if (!r) {
    r = new Set([file]);
    const todo = [file];
    for (let f = todo.pop(); f; f = todo.pop())
      for (const n of edges(f)) {
        if (r.has(n)) continue;
        r.add(n);
        todo.push(n);
      }
    REACH.set(file, r);
  }
  return r;
}

const slash = (p: string) => p.split(String.fromCharCode(92)).join('/');
const PRE = '(^|[^A-Za-z0-9_.])';
const STARTS = import.meta.glob('./kit*Start.ts', { eager: true });
const kits = START.map((f) => {
  const ns = f.replace(/Start\.ts$/, '');
  const used = FILES.filter((p) => new RegExp(PRE + ns + '[.]').test(text.get(p)!));
  const textFile = FILES.find(
    (p) => slash(p).endsWith('/text.ts') && new RegExp(PRE + ns + '[^A-Za-z0-9_]').test(text.get(p)!),
  );
  const dir = textFile ? dirname(textFile) : '';
  const startUp = (p: string) =>
    p === join(dir, 'meta.ts') ||
    p === join(dir, 'open.ts') ||
    slash(p).endsWith(`/page/registrations/${ns}.ts`) ||
    slash(p).endsWith('/features/tools/ui/tools.ts');
  const start = (STARTS[`./${f}`] as Record<string, object>)[`${ns}Start`]!;
  const inStart = (path: string[]) =>
    path.reduce<unknown>(
      (n, key) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[key] : undefined),
      start,
    ) !== undefined;
  /** The `kitX.…` keys a file names that start-up does not hold. */
  const outsideStart = (p: string) =>
    [...text.get(p)!.matchAll(new RegExp(PRE + ns + '[.]([A-Za-z0-9_.]*[A-Za-z0-9_])', 'g'))]
      .map((m) => m[2]!)
      .filter((key) => !inStart(key.split('.')));
  return { f, ns, used, textFile, startUp, outsideStart };
});

describe('kit text imports', () => {
  it('finds every kit and its text.ts', () => {
    expect(kits.length).toBeGreaterThanOrEqual(17);
    for (const k of kits) expect(k.textFile, k.ns).toBeTruthy();
  });

  it.each(kits.map((k) => [k.ns, k] as const))(
    '%s: every module that reads its later words reaches text.ts',
    (_ns, k) => {
      const bad = k.used
        .filter((p) => READS.test(text.get(p)!) && k.outsideStart(p).length > 0)
        .filter((p) => p !== k.textFile && !k.startUp(p) && !reach(p).has(k.textFile!))
        .map((p) => relative(SRC, p));
      expect(bad).toEqual([]);
    },
  );

  it.each(kits.map((k) => [k.ns, k] as const))('%s: start-up readers only read start-up words', (_ns, k) => {
    const missing = k.used
      .filter(k.startUp)
      .flatMap((p) => k.outsideStart(p).map((key) => `${relative(SRC, p)}: ${key}`));
    expect(missing).toEqual([]);
  });
});
