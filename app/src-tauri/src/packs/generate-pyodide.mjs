// Writes pyodide-packages.json: one entry for each package in Pyodide's lock file, with the exact size the app
// needs as its download cap (ADR 0070). The lock file lists a SHA-256 for every package but no size. The CDN
// answers without a Content-Length. So this script downloads each file once and counts its bytes. It checks the
// SHA-256 against the lock file before it writes the entry. A file whose checksum differs stops the script.
//
// Run: node app/src-tauri/src/packs/generate-pyodide.mjs [path/to/pyodide-lock.json]
// Without a path it fetches the lock file of the pinned version. Bump VERSION, run it, and update the Pyodide
// core files in catalog.rs together.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '314.0.7';
const BASE = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const LOCK = `https://cdn.jsdelivr.net/npm/pyodide@${VERSION}/pyodide-lock.json`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'pyodide-packages.json');
const PARALLEL = 6;

/** A package name as the lock file keys it (PEP 503): lower case, with each run of `-`, `_` and `.` as one `-`. */
const normalize = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

async function lockFile(path) {
  if (path) return JSON.parse(await readFile(path, 'utf8'));
  const response = await fetch(LOCK);
  if (!response.ok) throw new Error(`The lock file answered ${response.status}.`);
  return response.json();
}

/** Downloads one file and returns its size, after checking its SHA-256. */
async function measure(fileName, sha256) {
  const response = await fetch(BASE + fileName, { headers: { 'Accept-Encoding': 'identity' } });
  if (!response.ok || !response.body) throw new Error(`${fileName} answered ${response.status}.`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    size += chunk.length;
  }
  const found = hash.digest('hex');
  if (found !== sha256) throw new Error(`${fileName}: the SHA-256 is ${found}, and the lock file says ${sha256}.`);
  return size;
}

async function main() {
  const lock = await lockFile(process.argv[2]);
  const names = Object.keys(lock.packages).sort();
  const packages = [];
  let next = 0;
  async function worker() {
    while (next < names.length) {
      const key = names[next++];
      const entry = lock.packages[key];
      if (!/^[A-Za-z0-9._+-]+$/.test(entry.file_name)) throw new Error(`An unusual file name: ${entry.file_name}`);
      const size = await measure(entry.file_name, entry.sha256);
      const depends = entry.depends.map(normalize).sort();
      const missing = depends.find((name) => !(name in lock.packages));
      if (missing) throw new Error(`${key} needs ${missing}, which the lock file lacks.`);
      packages.push({
        id: key,
        name: entry.name,
        version: entry.version,
        file: entry.file_name,
        size,
        sha256: entry.sha256,
        depends,
      });
      process.stdout.write(`${packages.length}/${names.length} ${entry.name} ${size}\n`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  packages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = { version: VERSION, base: BASE, packages };
  await writeFile(OUT, `${JSON.stringify(body, null, 1)}\n`);
  process.stdout.write(`Wrote ${packages.length} packages to ${OUT}\n`);
}

await main();
