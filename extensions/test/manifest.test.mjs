import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { JSDOM } from 'jsdom';

import { addinManifest, build, manifestFor, zipFolder } from '../build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const clipperManifest = JSON.parse(readFileSync(join(here, '../clipper/manifest.json'), 'utf8'));
const addinXml = readFileSync(join(here, '../outlook-addin/manifest.xml'), 'utf8');

test('the clipper asks for as little as it can', () => {
  assert.equal(clipperManifest.manifest_version, 3);
  assert.deepEqual(clipperManifest.permissions.sort(), ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(clipperManifest.host_permissions, ['http://127.0.0.1/*']);
  assert.ok(!JSON.stringify(clipperManifest).includes('<all_urls>'));
  assert.ok(clipperManifest.optional_host_permissions.every((host) => host.startsWith('https://mail')));
  assert.match(clipperManifest.content_security_policy.extension_pages, /script-src 'self'; object-src 'none'/);
  assert.equal(clipperManifest.background.type, 'module');
  for (const file of ['popup.html', 'popup.js', 'background.js']) {
    assert.ok(existsSync(join(here, '../clipper', file)), file);
  }
});

test('Firefox gets its own background and id', () => {
  const firefox = manifestFor('firefox', clipperManifest);
  assert.deepEqual(firefox.background, { scripts: ['background.js'], type: 'module' });
  assert.equal(firefox.browser_specific_settings.gecko.id, 'clipper@opennote.app');
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.deepEqual(manifestFor('edge', clipperManifest), clipperManifest);
});

test('the Outlook manifest is valid, reads items only, and uses https everywhere', () => {
  const xml = addinManifest(addinXml, 'https://addin.example.org/opennote/');
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  assert.equal(doc.getElementsByTagName('parsererror').length, 0);
  const root = doc.documentElement;
  assert.equal(root.localName, 'OfficeApp');
  assert.equal(root.getAttribute('xsi:type'), 'MailApp');
  const text = (name) => doc.getElementsByTagName(name)[0]?.textContent?.trim();
  assert.match(text('Id'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(text('Version'), /^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(text('Permissions'), 'ReadItem');
  assert.equal(doc.getElementsByTagName('Set')[0].getAttribute('MinVersion'), '1.8');
  const urls = [...doc.querySelectorAll('[DefaultValue]')]
    .map((node) => node.getAttribute('DefaultValue'))
    .filter((value) => value.includes('://'));
  assert.ok(urls.length >= 6);
  for (const url of urls) assert.match(url, /^https:\/\//, url);
  assert.ok(!xml.includes('ADDIN_BASE'));
  assert.equal(text('AppDomain'), 'https://addin.example.org/opennote');
  // Every resource the button names exists.
  const ids = new Set([...doc.querySelectorAll('[id]')].map((node) => node.getAttribute('id')));
  for (const node of doc.querySelectorAll('[resid]'))
    assert.ok(ids.has(node.getAttribute('resid')), node.getAttribute('resid'));
  assert.throws(() => addinManifest(addinXml, 'http://addin.example.org'), /https/);
  assert.throws(() => addinManifest(addinXml, 'https://a.example"/><x'), /https/);
});

function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const out = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString();
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26);
    out.set(name, inflateRawSync(buffer.subarray(dataAt, dataAt + size)));
    at += 46 + nameLength;
  }
  return out;
}

test('the build makes a zip per browser and the add-in folder', () => {
  const made = build({ addinBase: 'https://localhost:3000' });
  assert.equal(made.length, 4);
  for (const browser of ['edge', 'chrome', 'firefox']) {
    const zip = made.find((path) => path.includes(`opennote-clipper-${browser}-`));
    const files = unzip(readFileSync(zip));
    const manifest = JSON.parse(files.get('manifest.json').toString());
    assert.equal(Boolean(manifest.browser_specific_settings), browser === 'firefox');
    for (const name of [
      'popup.html',
      'popup.js',
      'background.js',
      'shared/api.js',
      'lib/clip.js',
      'icons/icon-128.png',
    ]) {
      assert.ok(files.has(name), `${browser}: ${name}`);
    }
  }
  const pane = made[3];
  assert.ok(readdirSync(join(pane, 'shared')).includes('mail.js'));
  assert.match(readFileSync(join(pane, 'manifest.xml'), 'utf8'), /https:\/\/localhost:3000\/taskpane\.html/);
  // The same input zips to the same bytes.
  const folder = join(dirname(made[0]), 'clipper-edge');
  assert.ok(zipFolder(folder).equals(zipFolder(folder)));
});
