// The Rust side of the software bill of materials: the crates that are compiled into the exe.
//
// `cargo metadata` knows which crates the app needs on Windows, and whether each is needed to run or only to build.
// The lockfile has the SHA-256 of each downloaded crate.

export interface CargoDependency {
  pkg: string;
  dep_kinds: { kind: string | null; target: string | null }[];
}

export interface CargoMetadata {
  packages: {
    id: string;
    name: string;
    version: string;
    license: string | null;
    repository: string | null;
    source: string | null;
  }[];
  resolve: { nodes: { id: string; deps: CargoDependency[] }[] } | null;
}

export interface Crate {
  name: string;
  version: string;
  license?: string;
  repository?: string;
  /** SHA-256 of the downloaded crate, as lowercase hex. Local crates have none. */
  sha256?: string;
  /** True for a crate in this repository. */
  local: boolean;
  /** Ids ("name@version") of the crates this one needs. */
  needs: string[];
}

export const crateId = (name: string, version: string): string => `${name}@${version}`;

/** The checksum of each crate in a Cargo.lock, by "name@version". */
export function lockChecksums(lock: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const block of lock.split('[[package]]').slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const sum = /^checksum = "([0-9a-f]{64})"/m.exec(block)?.[1];
    if (name && version && sum) sums.set(crateId(name, version), sum);
  }
  return sums;
}

/** Whether a crate is needed in the finished exe: a normal dependency, or a build dependency used to compile it. */
const isShipped = (dependency: CargoDependency): boolean => dependency.dep_kinds.some(({ kind }) => kind !== 'dev');

/**
 * The crates `root` needs, found by following dependencies that aren't dev-only. Pass one metadata result for each
 * target the release builds (cargo metadata --filter-platform), and a crate that any target needs is included.
 */
export function shippedCrates(
  results: readonly CargoMetadata[],
  root: string,
  checksums: Map<string, string>,
): Crate[] {
  const crates = new Map<string, Crate>();
  for (const metadata of results) {
    const byId = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
    const nodes = new Map((metadata.resolve?.nodes ?? []).map((node) => [node.id, node]));
    const start = metadata.packages.find((pkg) => pkg.name === root && pkg.source === null);
    if (!start) throw new Error(`The cargo metadata has no crate named ${root}.`);
    const visited = new Set<string>();
    const visit = (id: string): void => {
      const pkg = byId.get(id);
      if (!pkg || visited.has(id)) return;
      visited.add(id);
      const key = crateId(pkg.name, pkg.version);
      const needs = (nodes.get(id)?.deps ?? []).filter(isShipped).flatMap((dep) => byId.get(dep.pkg) ?? []);
      const ids = new Set([...(crates.get(key)?.needs ?? []), ...needs.map((dep) => crateId(dep.name, dep.version))]);
      crates.set(key, {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? undefined,
        repository: pkg.repository ?? undefined,
        sha256: checksums.get(key),
        local: pkg.source === null,
        needs: [...ids].sort(),
      });
      needs.forEach((dep) => visit(dep.id));
    };
    visit(start.id);
  }
  return [...crates.values()].sort((a, b) => crateId(a.name, a.version).localeCompare(crateId(b.name, b.version)));
}
