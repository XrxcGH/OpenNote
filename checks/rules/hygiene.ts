// File hygiene: whitespace, line endings, invisible characters, merge markers, and leaked secrets.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { reporter } from './helpers.ts';

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00A0\u202F]/;

// Built from pieces so this file doesn't flag itself.
const SECRET_PATTERNS: RegExp[] = [
  new RegExp('AKIA' + '[0-9A-Z]{16}'),
  new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
  new RegExp('gh' + '[pousr]_[A-Za-z0-9]{36,}'),
  new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}'),
  new RegExp('xox' + '[baprs]-[A-Za-z0-9-]{10,}'),
  new RegExp('AI' + 'za[0-9A-Za-z_-]{35}'),
  // Tauri updater private keys, both as the key file and as its base64 form in TAURI_SIGNING_PRIVATE_KEY.
  new RegExp('untrusted comment: (?:rsign|minisign) ' + 'encrypted secret key'),
  new RegExp('dW50cnVzdGVkIGNvbW1lbnQ6I' + '(?:HJzaWdu|G1pbmlzaWdu)IGVuY3J5cHRlZCBzZWNyZXQga2V5'),
];

const MAX_BYTES = 1_000_000;

export const hygiene: Rule = {
  id: 'hygiene',
  description:
    'Trailing whitespace, final newline, line endings, invisible characters, merge markers, secrets and file size.',
  appliesTo: () => true,
  check(file) {
    const report = reporter('hygiene', file);
    const findings: Finding[] = [];
    file.lines.forEach((raw, index) => findings.push(...checkLine(file, raw, index + 1)));
    const last = file.lines.length;
    if (file.text.length > 0 && !file.text.endsWith('\n')) {
      const lastLine = file.lines[last - 1];
      findings.push(
        report(last, 'File must end with a newline.', 'error', { line: last, from: lastLine, to: `${lastLine}\n` }),
      );
    }
    if (file.text.length > MAX_BYTES)
      findings.push(report(1, 'File is larger than 1 MB. Store large assets outside the repository.'));
    return findings;
  },
};

function checkLine(file: SourceFile, raw: string, line: number): Finding[] {
  const report = reporter('hygiene', file);
  const findings: Finding[] = [];
  if (/[ \t\r]+$/.test(raw)) {
    const message = raw.endsWith('\r') ? 'Windows (CRLF) line ending; use LF.' : 'Trailing whitespace.';
    findings.push(report(line, message, 'error', { line, from: raw, to: raw.replace(/[ \t\r]+$/, '') }));
  }
  if (INVISIBLE.test(raw)) {
    const cleaned = raw.replace(/[\u00A0\u202F]/g, ' ').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    findings.push(
      report(line, 'Invisible or non-breaking space character.', 'error', { line, from: raw, to: cleaned }),
    );
  }
  if (/^(<{7}|>{7})( |$)/.test(raw)) findings.push(report(line, 'Unresolved merge conflict marker.'));
  if (SECRET_PATTERNS.some((pattern) => pattern.test(raw))) {
    findings.push(report(line, 'Possible secret or private key. Remove it and rotate the credential.'));
  }
  return findings;
}
