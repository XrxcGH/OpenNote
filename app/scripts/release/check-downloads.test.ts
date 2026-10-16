// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ENDPOINTS_MARKER } from '../check-release-exe.ts';
import { RELEASE_FILES } from '../write-manifest.ts';
import { SBOM_FILE, downloadProblems, expectedFrom, hashOutput, type Expected } from './check-downloads.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const SBOM = '{"bomFormat":"CycloneDX"}';
const keys = new Set<string>();

/** A folder as the package job downloads it, with the hashes the build and sbom jobs reported. */
function downloaded(): { dir: string; expected: Expected } {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-downloads-'));
  dirs.push(dir);
  const build: Record<string, string> = {};
  for (const { target, file } of RELEASE_FILES) {
    writeFileSync(join(dir, file), `exe for ${target}`);
    build[hashOutput(target)] = sha(`exe for ${target}`);
  }
  writeFileSync(join(dir, SBOM_FILE), SBOM);
  return { dir, expected: { build, sbom: sha(SBOM) } };
}

describe('downloadProblems', () => {
  it('passes the files the build and sbom jobs made, and nothing else', () => {
    const { dir, expected } = downloaded();
    expect(downloadProblems(dir, expected, { keys })).toEqual([]);
  });

  it('refuses an exe that another job of the run put in place of the one the build job made', () => {
    const { dir, expected } = downloaded();
    writeFileSync(join(dir, 'OpenNote_Windows64.exe'), 'something else');
    const built = sha('exe for x86_64-pc-windows-msvc');
    expect(downloadProblems(dir, expected, { keys })).toEqual([
      `OpenNote_Windows64.exe isn't the file its job made: its SHA-256 is ${sha('something else')}, not ${built}.`,
    ]);
  });

  it('refuses any other file or folder, which would be signed and published with the release', () => {
    const { dir, expected } = downloaded();
    writeFileSync(join(dir, 'OpenNote_Setup.exe'), 'extra');
    mkdirSync(join(dir, 'exe-zz'));
    expect(downloadProblems(dir, expected, { keys })).toEqual([
      `"OpenNote_Setup.exe" isn't a release file, so no job of the release may add it.`,
      `"exe-zz" isn't a release file, so no job of the release may add it.`,
    ]);
  });

  it('refuses a missing file, and a file whose job reported no hash', () => {
    const { dir, expected } = downloaded();
    rmSync(join(dir, 'OpenNote_Windows32.exe'));
    const build = { ...expected.build, [hashOutput('aarch64-pc-windows-msvc')]: '' };
    expect(downloadProblems(dir, { build, sbom: undefined }, { keys })).toEqual([
      'OpenNote_Windows32.exe is missing.',
      'The job that makes OpenNote_WindowsARM64.exe reported no SHA-256 for it.',
      `The job that makes ${SBOM_FILE} reported no SHA-256 for it.`,
    ]);
  });

  it('refuses a bill of materials that differs from the one the sbom job made', () => {
    const { dir, expected } = downloaded();
    writeFileSync(join(dir, SBOM_FILE), '{}');
    expect(downloadProblems(dir, expected, { keys })).toEqual([
      `${SBOM_FILE} isn't the file its job made: its SHA-256 is ${sha('{}')}, not ${sha(SBOM)}.`,
    ]);
  });
});

describe('downloadProblems on the exes themselves', () => {
  it('checks each exe again for test endpoints, as the build job did', () => {
    const { dir, expected } = downloaded();
    const contents = `exe ${TEST_ENDPOINTS_MARKER}`;
    writeFileSync(join(dir, 'OpenNote_WindowsARM64.exe'), contents);
    const build = { ...expected.build, [hashOutput('aarch64-pc-windows-msvc')]: sha(contents) };
    expect(downloadProblems(dir, { ...expected, build }, { keys })).toEqual([
      `OpenNote_WindowsARM64.exe: It was built with the test-endpoints feature: it contains ${TEST_ENDPOINTS_MARKER}.`,
    ]);
  });
});

describe('expectedFrom', () => {
  it("reads the build job's outputs as JSON, and the hash of the bill of materials", () => {
    const env = { BUILD_SHA256: '{\n  "sha256-x": "abc"\n}', SBOM_SHA256: 'def' };
    expect(expectedFrom(env)).toEqual({ build: { 'sha256-x': 'abc' }, sbom: 'def' });
  });

  it('stops when the build outputs are missing or not an object', () => {
    expect(() => expectedFrom({})).toThrow('BUILD_SHA256 is not set.');
    expect(() => expectedFrom({ BUILD_SHA256: '[]' })).toThrow('must be a JSON object');
    expect(() => expectedFrom({ BUILD_SHA256: 'null' })).toThrow('must be a JSON object');
  });
});
