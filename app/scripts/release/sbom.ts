// Writes the software bill of materials for a release: every npm package and Rust crate that is built into the
// exes, with versions, licenses, and hashes, as CycloneDX 1.5 JSON. It is a release file, so people and tools can
// see what OpenNote is made of without building it. The npm and Rust halves are in sbom-npm.ts and sbom-cargo.ts.
// Usage: node app/scripts/release/sbom.ts <version> <out-file> [--serial <urn:uuid:...>] [--timestamp <iso date>]

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_FILES, REPO } from '../write-manifest.ts';
import { lockChecksums, shippedCrates, type CargoMetadata, type Crate } from './sbom-cargo.ts';
import { importedPackages } from './sbom-imports.ts';
import { shippedPackages, type Lockfile, type NpmPackage } from './sbom-npm.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const APP_CRATE = 'opennote';

export interface Component {
  type: 'application' | 'library';
  'bom-ref': string;
  name: string;
  version: string;
  purl: string;
  scope?: 'required';
  licenses?: ({ expression: string } | { license: { name: string } })[];
  hashes?: { alg: 'SHA-256' | 'SHA-512'; content: string }[];
  externalReferences?: { type: string; url: string }[];
}

export interface Bom {
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  serialNumber: string;
  version: 1;
  metadata: { timestamp: string; tools: { components: { type: 'application'; name: string }[] }; component: Component };
  components: Component[];
  dependencies: { ref: string; dependsOn: string[] }[];
}

export interface SbomInput {
  /** The app's version, without a leading `v`. */
  version: string;
  npm: readonly NpmPackage[];
  crates: readonly Crate[];
  serial: string;
  timestamp: string;
}

/** A Package URL, the name other tools use to find a component. Scoped npm names write `@` as `%40`. */
export const npmPurl = (name: string, version: string): string => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
export const cargoPurl = (name: string, version: string): string => `pkg:cargo/${name}@${version}`;

/**
 * A license field as CycloneDX wants it: an SPDX expression when it looks like one, and the plain name for anything
 * else, such as `SEE LICENSE IN LICENSE.txt`. Older crates write `MIT/Apache-2.0`, which means `MIT OR Apache-2.0`.
 */
export function licenseOf(text: string | undefined): Component['licenses'] {
  const cleaned = text?.trim().replace(/\s*\/\s*/g, ' OR ');
  if (!cleaned) return undefined;
  return [looksLikeSpdx(cleaned) ? { expression: cleaned } : { license: { name: cleaned } }];
}

/** True for ids joined by AND, OR, and WITH, and grouped in parentheses. Two ids side by side are plain words. */
function looksLikeSpdx(text: string): boolean {
  if (!/^[A-Za-z0-9.+() -]+$/.test(text)) return false;
  const tokens = text.split(/[\s()]+/).filter(Boolean);
  const isOperator = (token: string): boolean => /^(AND|OR|WITH)$/.test(token);
  return tokens.every((token, at) => at === 0 || isOperator(token) || isOperator(tokens[at - 1]));
}

function npmComponent(pkg: NpmPackage): Component {
  const purl = npmPurl(pkg.name, pkg.version);
  const references = pkg.resolved?.startsWith('https://') ? [{ type: 'distribution', url: pkg.resolved }] : undefined;
  return {
    type: 'library',
    'bom-ref': purl,
    name: pkg.name,
    version: pkg.version,
    purl,
    scope: 'required',
    licenses: licenseOf(pkg.license),
    hashes: pkg.sha512 ? [{ alg: 'SHA-512', content: pkg.sha512 }] : undefined,
    externalReferences: references,
  };
}

function crateComponent(crate: Crate): Component {
  const purl = cargoPurl(crate.name, crate.version);
  const url = crate.repository ?? (crate.local ? `https://github.com/${REPO}` : undefined);
  return {
    type: 'library',
    'bom-ref': purl,
    name: crate.name,
    version: crate.version,
    purl,
    scope: 'required',
    licenses: licenseOf(crate.license),
    hashes: crate.sha256 ? [{ alg: 'SHA-256', content: crate.sha256 }] : undefined,
    externalReferences: url ? [{ type: 'vcs', url }] : undefined,
  };
}

/** Builds the bill of materials. The same input always gives the same output. */
export function buildSbom(input: SbomInput): Bom {
  const byPath = new Map(input.npm.map((pkg) => [pkg.path, pkg]));
  const dependencies = new Map<string, Set<string>>();
  const components = new Map<string, Component>();
  for (const pkg of input.npm) {
    const component = npmComponent(pkg);
    components.set(component.purl, component);
    const needs = pkg.needs.flatMap((path) => byPath.get(path) ?? []).map((dep) => npmPurl(dep.name, dep.version));
    dependencies.set(component.purl, new Set([...(dependencies.get(component.purl) ?? []), ...needs]));
  }
  for (const crate of input.crates) {
    const component = crateComponent(crate);
    components.set(component.purl, component);
    const needs = crate.needs.map((id) => id.replace(/^(.*)@(.*)$/, (_, name, version) => cargoPurl(name, version)));
    dependencies.set(component.purl, new Set(needs));
  }
  const root = `pkg:github/${REPO.toLowerCase()}@v${input.version}`;
  const direct = [
    ...input.npm.filter((pkg) => pkg.direct).map((pkg) => npmPurl(pkg.name, pkg.version)),
    ...input.crates.filter((crate) => crate.name === APP_CRATE).map((crate) => cargoPurl(crate.name, crate.version)),
  ];
  const sorted = [...components.values()].sort((a, b) => a.purl.localeCompare(b.purl));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: input.serial,
    version: 1,
    metadata: {
      timestamp: input.timestamp,
      tools: { components: [{ type: 'application', name: 'OpenNote release scripts (app/scripts/release/sbom.ts)' }] },
      component: {
        type: 'application',
        'bom-ref': root,
        name: 'OpenNote',
        version: input.version,
        purl: root,
        licenses: licenseOf('Apache-2.0'),
        externalReferences: [{ type: 'vcs', url: `https://github.com/${REPO}` }],
      },
    },
    components: sorted,
    dependencies: [
      { ref: root, dependsOn: direct.sort() },
      ...sorted.map((component) => ({
        ref: component.purl,
        dependsOn: [...(dependencies.get(component.purl) ?? [])].sort(),
      })),
    ],
  };
}

/** Reads the repository: the app's imports, package-lock.json, Cargo.lock, and cargo metadata for each target. */
export function readInput(version: string, serial: string, timestamp: string): SbomInput {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile;
  const npm = shippedPackages(lock, importedPackages(join(ROOT, 'app', 'src', 'main.tsx')));
  const results = RELEASE_FILES.map(({ target }) => {
    const args = ['metadata', '--format-version', '1', '--locked', '--filter-platform', target];
    return JSON.parse(
      execFileSync('cargo', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
    ) as CargoMetadata;
  });
  const checksums = lockChecksums(readFileSync(join(ROOT, 'Cargo.lock'), 'utf8'));
  return { version, npm, crates: shippedCrates(results, APP_CRATE, checksums), serial, timestamp };
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function main(): void {
  const args = process.argv.slice(2);
  const [version, out] = args;
  if (!version || !out) throw new Error('Usage: node app/scripts/release/sbom.ts <version> <out-file>');
  const serial = option(args, '--serial') ?? `urn:uuid:${randomUUID()}`;
  const input = readInput(version.replace(/^v/, ''), serial, option(args, '--timestamp') ?? new Date().toISOString());
  writeFileSync(out, `${JSON.stringify(buildSbom(input), null, 2)}\n`);
  console.log(`Wrote ${out}: ${input.npm.length} npm packages and ${input.crates.length} Rust crates.`);
}

if (import.meta.main) main();
