// Builds the browser clipper for Edge, Chrome, and Firefox, and the Outlook add-in, into extensions/dist:
//
//   dist/clipper-<browser>/          an unpacked extension, for "Load unpacked" while developing
//   dist/opennote-clipper-<browser>-<version>.zip   what the owner uploads to each store
//   dist/outlook-addin/              the task pane to host over https, with its manifest.xml filled in
//
// Usage: node extensions/build.mjs [--addin-base https://host/path]
// The add-in's address also comes from OPENNOTE_ADDIN_BASE; without either it is https://localhost:3000 for
// sideloading. Publishing to the stores and hosting the add-in are the owner's steps (docs/RELEASING.md).

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(here, 'dist');
const ICONS = { 'icon-32.png': '32x32.png', 'icon-64.png': '64x64.png', 'icon-128.png': '128x128.png' };
export const BROWSERS = ['edge', 'chrome', 'firefox'];

/** The clipper's manifest for one browser. Firefox runs the background as a module script, not a service worker. */
export function manifestFor(browser, base) {
  const manifest = structuredClone(base);
  if (browser === 'firefox') {
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = { gecko: { id: 'clipper@opennote.app', strict_min_version: '128.0' } };
    delete manifest.minimum_chrome_version;
  }
  return manifest;
}

/** The add-in's manifest with its hosting address, which must be https and end without a slash. */
export function addinManifest(xml, base) {
  const clean = String(base).replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(clean)) {
    throw new Error(`The add-in's address must be an https address, not ${base}`);
  }
  return xml.replaceAll('ADDIN_BASE', clean);
}

function files(folder) {
  const out = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else out.push(path);
  }
  return out.sort();
}

/** A zip of a folder: deflated entries, forward-slash paths, and a fixed date so builds repeat byte for byte. */
export function zipFolder(folder) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const path of files(folder)) {
    const name = Buffer.from(relative(folder, path).split('\\').join('/'));
    const data = readFileSync(path);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function copyIcons(target) {
  mkdirSync(join(target, 'icons'), { recursive: true });
  for (const [name, source] of Object.entries(ICONS)) {
    cpSync(join(root, 'app/src-tauri/icons', source), join(target, 'icons', name));
  }
}

export function build({ addinBase = process.env.OPENNOTE_ADDIN_BASE || 'https://localhost:3000' } = {}) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const clipper = join(here, 'clipper');
  const base = JSON.parse(readFileSync(join(clipper, 'manifest.json'), 'utf8'));
  const built = [];
  for (const browser of BROWSERS) {
    const target = join(dist, `clipper-${browser}`);
    for (const part of ['popup.html', 'popup.css', 'popup.js', 'background.js', 'lib', 'shared']) {
      cpSync(join(clipper, part), join(target, part), { recursive: true });
    }
    copyIcons(target);
    writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifestFor(browser, base), null, 2)}\n`);
    const zip = join(dist, `opennote-clipper-${browser}-${base.version}.zip`);
    writeFileSync(zip, zipFolder(target));
    built.push(zip);
  }
  const addin = join(here, 'outlook-addin');
  const pane = join(dist, 'outlook-addin');
  for (const part of ['taskpane.html', 'taskpane.css', 'taskpane.js', 'lib']) {
    cpSync(join(addin, part), join(pane, part), { recursive: true });
  }
  cpSync(join(clipper, 'shared'), join(pane, 'shared'), { recursive: true });
  copyIcons(pane);
  writeFileSync(
    join(pane, 'manifest.xml'),
    addinManifest(readFileSync(join(addin, 'manifest.xml'), 'utf8'), addinBase),
  );
  built.push(pane);
  return built;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--addin-base');
  const made = build(at > 0 ? { addinBase: process.argv[at + 1] } : {});
  for (const path of made) console.log(relative(root, path));
}
