// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKSUMS_FILE, checksumLines, writeChecksums } from './checksums.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-sums-'));
  dirs.push(dir);
  return dir;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('checksumLines', () => {
  it('writes hash, two spaces, and name, sorted by name', () => {
    const dir = folder();
    writeFileSync(join(dir, 'b.txt'), 'bee');
    writeFileSync(join(dir, 'a.txt'), 'ay');
    expect(checksumLines(dir, ['b.txt', 'a.txt'])).toEqual([`${sha('ay')}  a.txt`, `${sha('bee')}  b.txt`]);
  });
});

describe('writeChecksums', () => {
  it('lists every file but itself and any folder, and can be run again with the same result', () => {
    const dir = folder();
    writeFileSync(join(dir, 'OpenNote_Windows64.exe'), 'exe');
    writeFileSync(join(dir, 'latest.json'), '{}');
    mkdirSync(join(dir, 'nested'));
    expect(writeChecksums(dir)).toBe(2);
    const first = readFileSync(join(dir, CHECKSUMS_FILE), 'utf8');
    // Names sort by character code, so the capital O of OpenNote comes before the lowercase l of latest.
    expect(first).toBe(`${sha('exe')}  OpenNote_Windows64.exe\n${sha('{}')}  latest.json\n`);
    expect(writeChecksums(dir)).toBe(2);
    expect(readFileSync(join(dir, CHECKSUMS_FILE), 'utf8')).toBe(first);
  });
});
