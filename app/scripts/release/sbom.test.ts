// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lockChecksums, shippedCrates, type CargoMetadata } from './sbom-cargo.ts';
import { importedPackages } from './sbom-imports.ts';
import { resolveDependency, shippedPackages, type Lockfile } from './sbom-npm.ts';
import { buildSbom, licenseOf, npmPurl, cargoPurl } from './sbom.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const HEX = Buffer.from('hash').toString('hex');
const LOCK: Lockfile = {
  packages: {
    '': { version: '1.0.0' },
    'node_modules/react': {
      version: '19.0.0',
      license: 'MIT',
      integrity: `sha512-${Buffer.from('hash').toString('base64')}`,
      resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz',
      dependencies: { scheduler: '^1' },
    },
    'node_modules/scheduler': { version: '1.0.0', license: 'MIT' },
    'node_modules/@scope/editor': {
      version: '3.0.0',
      license: 'Apache-2.0 OR MIT',
      dependencies: { scheduler: '^2' },
      peerDependencies: { missing: '*' },
    },
    'node_modules/@scope/editor/node_modules/scheduler': { version: '2.0.0', license: 'ISC' },
    'node_modules/eslint': { version: '10.0.0', license: 'MIT' },
  },
};

describe('which npm packages ship', () => {
  it('finds the copy of a package that Node would load', () => {
    expect(resolveDependency(LOCK, '', 'scheduler')).toBe('node_modules/scheduler');
    expect(resolveDependency(LOCK, 'node_modules/@scope/editor', 'scheduler')).toBe(
      'node_modules/@scope/editor/node_modules/scheduler',
    );
    expect(resolveDependency(LOCK, 'node_modules/react', 'scheduler')).toBe('node_modules/scheduler');
    expect(resolveDependency(LOCK, '', 'missing')).toBeUndefined();
  });

  it('follows the lockfile from the imports, so dev tools stay out and both schedulers stay in', () => {
    const packages = shippedPackages(LOCK, ['react', '@scope/editor', 'not-installed']);
    expect(packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual([
      '@scope/editor@3.0.0',
      'scheduler@2.0.0',
      'react@19.0.0',
      'scheduler@1.0.0',
    ]);
    const react = packages.find((pkg) => pkg.name === 'react');
    expect(react).toMatchObject({ direct: true, sha512: HEX, needs: ['node_modules/scheduler'] });
    expect(packages.find((pkg) => pkg.version === '1.0.0')?.direct).toBe(false);
  });

  it('finds the real dependencies of the app in this repository', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile;
    const names = shippedPackages(lock, importedPackages(join(ROOT, 'app', 'src', 'main.tsx'))).map((pkg) => pkg.name);
    expect(names).toEqual(expect.arrayContaining(['react', 'react-dom', '@tauri-apps/api']));
    expect(names).not.toContain('eslint');
    expect(names).not.toContain('vitest');
  }, 60_000);
});

const metadata = (extra: Partial<CargoMetadata['resolve'] & object> = {}): CargoMetadata => ({
  packages: [
    { id: 'app', name: 'opennote', version: '1.0.0', license: 'Apache-2.0', repository: null, source: null },
    {
      id: 'serde',
      name: 'serde',
      version: '1.0.1',
      license: 'MIT/Apache-2.0',
      repository: 'https://github.com/serde-rs/serde',
      source: 'registry',
    },
    { id: 'cc', name: 'cc', version: '1.2.3', license: 'MIT OR Apache-2.0', repository: null, source: 'registry' },
    { id: 'proptest', name: 'proptest', version: '1.0.0', license: 'MIT', repository: null, source: 'registry' },
    { id: 'windows', name: 'windows', version: '0.62.0', license: 'MIT', repository: null, source: 'registry' },
  ],
  resolve: {
    nodes: [
      {
        id: 'app',
        deps: [
          { pkg: 'serde', dep_kinds: [{ kind: null, target: null }] },
          { pkg: 'cc', dep_kinds: [{ kind: 'build', target: null }] },
          { pkg: 'proptest', dep_kinds: [{ kind: 'dev', target: null }] },
          { pkg: 'windows', dep_kinds: [{ kind: null, target: 'cfg(windows)' }] },
        ],
      },
      { id: 'serde', deps: [] },
      { id: 'cc', deps: [] },
      { id: 'proptest', deps: [] },
      { id: 'windows', deps: [] },
    ],
    ...extra,
  },
});

/** A Cargo.lock with these crates: name, version, and an optional checksum. */
function cargoLock(crates: [string, string, string?][]): string {
  const block = ([name, version, sum]: [string, string, string?]) =>
    ['[[package]]', `name = "${name}"`, `version = "${version}"`, ...(sum ? [`checksum = "${sum}"`] : [])].join('\n');
  return crates.map(block).join('\n\n');
}

describe('which crates ship', () => {
  const lock = cargoLock([
    ['serde', '1.0.1', 'ab'.repeat(32)],
    ['opennote', '1.0.0'],
  ]);

  it('reads checksums from Cargo.lock, and none for crates in this repository', () => {
    expect([...lockChecksums(lock)]).toEqual([['serde@1.0.1', 'ab'.repeat(32)]]);
  });

  it('keeps normal and build dependencies and drops dev-only ones', () => {
    const crates = shippedCrates([metadata()], 'opennote', lockChecksums(lock));
    expect(crates.map((crate) => crate.name)).toEqual(['cc', 'opennote', 'serde', 'windows']);
    const app = crates.find((crate) => crate.name === 'opennote');
    expect(app).toMatchObject({ local: true, needs: ['cc@1.2.3', 'serde@1.0.1', 'windows@0.62.0'] });
    expect(crates.find((crate) => crate.name === 'serde')).toMatchObject({ sha256: 'ab'.repeat(32), local: false });
  });

  it('includes a crate that any target needs, once', () => {
    const arm = metadata();
    arm.resolve?.nodes[0].deps.pop();
    const crates = shippedCrates([arm, metadata()], 'opennote', new Map());
    expect(crates.filter((crate) => crate.name === 'windows')).toHaveLength(1);
    expect(crates.find((crate) => crate.name === 'opennote')?.needs).toContain('windows@0.62.0');
  });

  it('stops when the app crate is not in the metadata', () => {
    expect(() => shippedCrates([metadata()], 'other', new Map())).toThrow('no crate named other');
  });
});

describe('licenseOf', () => {
  it('writes SPDX expressions as expressions, and old slash forms with OR', () => {
    expect(licenseOf('MIT')).toEqual([{ expression: 'MIT' }]);
    expect(licenseOf('MIT/Apache-2.0')).toEqual([{ expression: 'MIT OR Apache-2.0' }]);
    expect(licenseOf('(MIT OR Apache-2.0) AND BSD-3-Clause')).toEqual([
      { expression: '(MIT OR Apache-2.0) AND BSD-3-Clause' },
    ]);
    expect(licenseOf('Apache-2.0 WITH LLVM-exception')).toEqual([{ expression: 'Apache-2.0 WITH LLVM-exception' }]);
  });

  it('keeps anything else as a name, and says nothing when there is no license', () => {
    expect(licenseOf('SEE LICENSE IN LICENSE.txt')).toEqual([{ license: { name: 'SEE LICENSE IN LICENSE.txt' } }]);
    expect(licenseOf('Custom <license>')).toEqual([{ license: { name: 'Custom <license>' } }]);
    expect(licenseOf('  ')).toBeUndefined();
    expect(licenseOf(undefined)).toBeUndefined();
  });
});

describe('buildSbom', () => {
  const sbom = buildSbom({
    version: '1.0.0',
    npm: shippedPackages(LOCK, ['react', '@scope/editor']),
    crates: shippedCrates(
      [metadata()],
      'opennote',
      lockChecksums(`[[package]]\nname = "serde"\nversion = "1.0.1"\nchecksum = "${'ab'.repeat(32)}"\n`),
    ),
    serial: 'urn:uuid:11111111-2222-4333-8444-555555555555',
    timestamp: '2026-10-14T18:02:11.000Z',
  });

  it('is a CycloneDX 1.5 document about OpenNote', () => {
    expect(sbom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1 });
    expect(sbom.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(sbom.metadata.component).toMatchObject({ name: 'OpenNote', version: '1.0.0', type: 'application' });
  });

  it('lists each component once, with a package URL, license, and hash', () => {
    const refs = sbom.components.map((component) => component['bom-ref']);
    expect(new Set(refs).size).toBe(refs.length);
    const react = sbom.components.find((component) => component.name === 'react');
    expect(react).toMatchObject({
      purl: npmPurl('react', '19.0.0'),
      licenses: [{ expression: 'MIT' }],
      hashes: [{ alg: 'SHA-512', content: HEX }],
    });
    const serde = sbom.components.find((component) => component.name === 'serde');
    expect(serde).toMatchObject({
      purl: cargoPurl('serde', '1.0.1'),
      licenses: [{ expression: 'MIT OR Apache-2.0' }],
      hashes: [{ alg: 'SHA-256', content: 'ab'.repeat(32) }],
    });
    expect(npmPurl('@scope/editor', '3.0.0')).toBe('pkg:npm/%40scope/editor@3.0.0');
  });

  it('records what needs what, and every reference points at a listed component', () => {
    const known = new Set([
      sbom.metadata.component['bom-ref'],
      ...sbom.components.map((component) => component['bom-ref']),
    ]);
    for (const entry of sbom.dependencies) {
      expect(known.has(entry.ref), entry.ref).toBe(true);
      entry.dependsOn.forEach((ref) => expect(known.has(ref), ref).toBe(true));
    }
    const root = sbom.dependencies[0];
    expect(root.dependsOn).toEqual([
      'pkg:cargo/opennote@1.0.0',
      'pkg:npm/%40scope/editor@3.0.0',
      'pkg:npm/react@19.0.0',
    ]);
    const reactNeeds = sbom.dependencies.find((entry) => entry.ref === 'pkg:npm/react@19.0.0')?.dependsOn;
    expect(reactNeeds).toEqual(['pkg:npm/scheduler@1.0.0']);
  });

  it('is the same every time for the same input', () => {
    expect(JSON.stringify(sbom)).toBe(JSON.stringify(structuredClone(sbom)));
  });
});
