// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargoVersion, mismatches, versionsIn } from './check-version.ts';

describe('cargoVersion', () => {
  it('reads the version from the [package] table only', () => {
    const toml = [
      '[workspace.package]',
      'version = "9.9.9"',
      '',
      '[package]',
      'name = "opennote"',
      'version = "0.5.0-beta.1"',
      '',
      '[dependencies]',
      'serde = { version = "1" }',
    ].join('\n');
    expect(cargoVersion(toml)).toBe('0.5.0-beta.1');
  });

  it('returns nothing when the package has no version', () => {
    expect(cargoVersion('[package]\nname = "opennote"\n\n[dependencies]\nversion = "1"\n')).toBeUndefined();
  });
});

describe('mismatches', () => {
  const files = (version: string | undefined) => ({
    'package.json': version,
    'app/src-tauri/Cargo.toml': version,
    'app/src-tauri/tauri.conf.json': version,
  });

  it('passes when every file matches the tag without its v', () => {
    expect(mismatches('v0.5.0', files('0.5.0'))).toEqual([]);
    expect(mismatches('v0.5.0-beta.1', files('0.5.0-beta.1'))).toEqual([]);
  });

  it('names each file that differs', () => {
    const found = mismatches('v0.5.0', { ...files('0.5.0'), 'app/src-tauri/Cargo.toml': '0.4.1' });
    expect(found).toEqual(['app/src-tauri/Cargo.toml has 0.4.1, but the tag v0.5.0 needs 0.5.0.']);
  });

  it('treats a missing version as a mismatch', () => {
    expect(mismatches('v0.5.0', files(undefined))).toHaveLength(3);
    expect(mismatches('v0.5.0', files(undefined))[0]).toMatch(/has no version/);
  });

  it('agrees with the version files in this repository', () => {
    const versions = versionsIn(join(import.meta.dirname, '..', '..'));
    expect(Object.keys(versions)).toHaveLength(3);
    expect(mismatches(`v${versions['package.json']}`, versions)).toEqual([]);
  });
});
