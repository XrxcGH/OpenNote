// The npm side of the software bill of materials: the packages that end up inside the exe. The interface is built
// by Vite from the packages that the app source imports, and some of them, such as the editor, are devDependencies.
// So "shipped" can't be read from the lockfile's dev flag. This starts from the packages that sbom-imports.ts found
// in the interface bundle, and follows package-lock.json from there.

export interface LockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  link?: boolean;
}

export interface Lockfile {
  packages: Record<string, LockPackage>;
}

export interface NpmPackage {
  name: string;
  version: string;
  license?: string;
  /** SHA-512 as lowercase hex, from the lockfile's integrity field. */
  sha512?: string;
  resolved?: string;
  /** Lockfile paths of the packages this one needs. */
  needs: string[];
  path: string;
  /** True when the app source imports it, rather than another package needing it. */
  direct: boolean;
}

/** Where `name` resolves from the package at `from`: its own node_modules, then each parent's, as Node does. */
export function resolveDependency(lock: Lockfile, from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (base === '') return undefined;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

function integrityHex(integrity: string | undefined): string | undefined {
  const match = /^sha512-(.+)$/.exec(integrity ?? '');
  return match ? Buffer.from(match[1], 'base64').toString('hex') : undefined;
}

function nameAt(path: string): string {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** The packages the exe needs: the imported ones and everything they depend on, by the lockfile. */
export function shippedPackages(lock: Lockfile, imported: readonly string[]): NpmPackage[] {
  const result = new Map<string, NpmPackage>();
  const roots = imported.flatMap((name) => resolveDependency(lock, '', name) ?? []);
  const visit = (path: string): void => {
    const entry = lock.packages[path];
    if (result.has(path) || !entry?.version) return;
    const names = Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies });
    const needs = names.flatMap((name) => resolveDependency(lock, path, name) ?? []);
    result.set(path, {
      name: nameAt(path),
      version: entry.version,
      license: entry.license,
      sha512: integrityHex(entry.integrity),
      resolved: entry.resolved,
      needs,
      path,
      direct: roots.includes(path),
    });
    needs.forEach(visit);
  };
  roots.forEach(visit);
  return [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
}
