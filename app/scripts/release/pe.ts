// Tells whether a Windows exe carries an embedded Authenticode signature, without asking the operating system, so
// the release checklist can check it on any machine. This only finds the signature. Windows decides whether the
// certificate chain is valid, and `windowsSignatureStatus` asks it when the script runs on Windows.

import { execFileSync } from 'node:child_process';

const PE_POINTER = 0x3c;
const PE32 = 0x10b;
const PE32_PLUS = 0x20b;
/** The certificate table is the fifth entry in the optional header's data directory. */
const SECURITY_ENTRY = 4;

/**
 * True when the PE file has a certificate table, which is where Authenticode puts its signature. A file that is
 * not a PE file, or is cut short, counts as unsigned.
 */
export function hasAuthenticode(exe: Buffer): boolean {
  if (exe.length < PE_POINTER + 4) return false;
  const header = exe.readUInt32LE(PE_POINTER);
  if (header + 24 + 2 > exe.length || exe.toString('latin1', header, header + 4) !== 'PE\0\0') return false;
  const optional = header + 24;
  const magic = exe.readUInt16LE(optional);
  if (magic !== PE32 && magic !== PE32_PLUS) return false;
  const countAt = optional + (magic === PE32 ? 92 : 108);
  const entryAt = optional + (magic === PE32 ? 96 : 112) + SECURITY_ENTRY * 8;
  if (entryAt + 8 > exe.length || exe.readUInt32LE(countAt) <= SECURITY_ENTRY) return false;
  const offset = exe.readUInt32LE(entryAt);
  const size = exe.readUInt32LE(entryAt + 4);
  return offset > 0 && size > 0 && offset + size <= exe.length;
}

/**
 * What Windows says about the signature: `Valid`, or another status such as `NotSigned` or `UnknownError`. It
 * returns undefined off Windows, where nothing can answer.
 */
export function windowsSignatureStatus(path: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  // The path goes in an environment variable, so no file name can change what the command does.
  const script = '(Get-AuthenticodeSignature -LiteralPath $env:OPENNOTE_EXE).Status';
  // PSModulePath is left out so Windows PowerShell builds its own. Started from PowerShell 7 (as on CI runners), the
  // inherited one lists PowerShell 7's modules first, and Windows PowerShell then fails to load the Security module.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...env, OPENNOTE_EXE: path },
  });
  return output.trim();
}
