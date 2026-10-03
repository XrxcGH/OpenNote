// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAuthenticode, windowsSignatureStatus } from './pe.ts';
import { fakePe } from './test-support.ts';

describe('hasAuthenticode', () => {
  it.each([true, false])('finds the certificate table of a PE32+ or PE32 file (plus: %s)', (plus) => {
    expect(hasAuthenticode(fakePe({ plus, signed: true }))).toBe(true);
    expect(hasAuthenticode(fakePe({ plus, signed: false }))).toBe(false);
  });

  it('treats a table that points outside the file as unsigned', () => {
    const exe = fakePe({ signed: true });
    exe.writeUInt32LE(0x1000, 0x80 + 24 + 112 + 32);
    expect(hasAuthenticode(exe)).toBe(false);
  });

  it('treats a header with too few directories as unsigned', () => {
    expect(hasAuthenticode(fakePe({ signed: true, directories: 3 }))).toBe(false);
  });

  it('treats other files as unsigned without crashing', () => {
    expect(hasAuthenticode(Buffer.alloc(0))).toBe(false);
    expect(hasAuthenticode(Buffer.from('MZ'))).toBe(false);
    expect(hasAuthenticode(Buffer.from('not an exe at all, just some text that is long enough'))).toBe(false);
    const wrongSignature = fakePe({ signed: true });
    wrongSignature.write('XX', 0x80, 'latin1');
    expect(hasAuthenticode(wrongSignature)).toBe(false);
    const pointer = fakePe();
    pointer.writeUInt32LE(0xfffffff0, 0x3c);
    expect(hasAuthenticode(pointer)).toBe(false);
  });
});

describe.skipIf(process.platform !== 'win32')('on Windows', () => {
  it('finds the signature of the Node program that runs the tests, and asks Windows about it', () => {
    expect(hasAuthenticode(readFileSync(process.execPath))).toBe(true);
    expect(windowsSignatureStatus(process.execPath)).toMatch(/^[A-Za-z]+$/);
  }, 60_000);
});

describe.skipIf(process.platform === 'win32')('off Windows', () => {
  it('has no answer from the operating system', () => {
    expect(windowsSignatureStatus(process.execPath)).toBeUndefined();
  });
});
