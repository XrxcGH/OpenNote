import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const parse = (path) => {
  const doc = new JSDOM(readFileSync(join(root, path), 'utf8'), { contentType: 'text/xml' }).window.document;
  assert.equal(doc.getElementsByTagName('parsererror').length, 0, path);
  return doc;
};

test('the sparse package shares text, links, pictures, and any file to OpenNote.exe', () => {
  const doc = parse('packaging/msix/AppxManifest.xml');
  const identity = doc.getElementsByTagName('Identity')[0];
  assert.equal(identity.getAttribute('Name'), 'OpenNote.ShareTarget');
  assert.equal(identity.getAttribute('Publisher'), 'PUBLISHER');
  assert.equal(doc.getElementsByTagName('uap10:AllowExternalContent')[0].textContent, 'true');
  const app = doc.getElementsByTagName('Application')[0];
  assert.equal(app.getAttribute('Id'), 'OpenNote');
  assert.equal(app.getAttribute('Executable'), 'OpenNote.exe');
  assert.equal(app.getAttribute('uap10:RuntimeBehavior'), 'win32App');
  const formats = [...doc.getElementsByTagName('uap:DataFormat')].map((node) => node.textContent);
  assert.deepEqual(formats.sort(), ['Bitmap', 'StorageItems', 'Text', 'URI']);
  assert.equal(doc.getElementsByTagName('uap:SupportsAnyFileType').length, 1);
  const capabilities = [...doc.getElementsByTagName('rescap:Capability')].map((node) => node.getAttribute('Name'));
  assert.deepEqual(capabilities.sort(), ['runFullTrust', 'unvirtualizedResources']);
  assert.equal(doc.getElementsByTagName('uap:VisualElements')[0].getAttribute('AppListEntry'), 'none');
});

test('the exe names the same package and application', () => {
  const pkg = parse('packaging/msix/AppxManifest.xml');
  const exe = parse('app/src-tauri/windows-app.manifest');
  const msix = exe.getElementsByTagName('msix')[0];
  assert.equal(msix.getAttribute('packageName'), pkg.getElementsByTagName('Identity')[0].getAttribute('Name'));
  assert.equal(msix.getAttribute('applicationId'), pkg.getElementsByTagName('Application')[0].getAttribute('Id'));
  assert.equal(msix.getAttribute('publisher'), 'PUBLISHER');
  const controls = exe.getElementsByTagName('assemblyIdentity')[0];
  assert.equal(controls.getAttribute('name'), 'Microsoft.Windows.Common-Controls');
});

test('the logos the package names exist', () => {
  const doc = parse('packaging/msix/AppxManifest.xml');
  const logos = [doc.getElementsByTagName('Logo')[0].textContent];
  const visual = doc.getElementsByTagName('uap:VisualElements')[0];
  logos.push(visual.getAttribute('Square150x150Logo'), visual.getAttribute('Square44x44Logo'));
  for (const logo of logos) {
    const file = logo.replace(/^Assets\\/, '');
    assert.ok(readFileSync(join(root, 'app/src-tauri/icons', file)).length > 0, file);
  }
});
