// Keeps the flag registry honest: every registered flag is read somewhere (in the app, or in the Rust side by
// name), and every FlagId has a definition. A flag nothing reads is dead weight that looks like a feature
// (docs/testing/README.md, "Flag check"). A flag whose feature is not built yet goes in WAITING with a reason, and
// leaves the list when the feature lands.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAGS } from './flags';

const SRC = join(import.meta.dirname, '..');
const RUST = join(SRC, '..', 'src-tauri', 'src');

/** Registered flags whose feature is not built yet (docs/FEATURES.md lists each as not built). */
const WAITING: Readonly<Record<string, string>> = {
  'install.uninstallEntry': 'the per-user Installed apps entry waits for the installer work',
  'updates.resume': 'resuming a partial update download is not built',
  'study.import': 'read where deck import and export show once the tools work lands',
  'tools.exams': 'read where exam countdowns show once the tools work lands',
  'tools.timetable': 'read where the timetable shows once the tools work lands',
  'interop.openFiles': 'Open with OpenNote for single files is not built',
  'interop.share': 'Share as a file is not built',
  'tools.dictionary': 'the dictionary and thesaurus tool window has no content yet',
  'api.local': 'the local API, opennote tool, and MCP server are not built',
  'page.imageRenditions': 'display-size renditions wait for spike S3 (docs/adr/0025-paste-and-images.md)',
};

function sources(dir: string, pattern: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, pattern, out);
    else if (pattern.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const files = sources(SRC, /\.tsx?$/);
const isFlagsFile = (path: string) => basename(path) === 'flags.ts';
const flagFiles = files.filter(isFlagsFile);
const texts = [...files.filter((path) => !isFlagsFile(path)), ...sources(RUST, /\.rs$/)].map((path) =>
  readFileSync(path, 'utf8'),
);

/** Flag ids are dotted words such as 'page.images'. */
const ID = /'([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+)'/g;

/** The members of the FlagId unions: the lines that start a union member with a bar, in the flags files. */
function declared(): Set<string> {
  const ids = new Set<string>();
  for (const path of flagFiles) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/^\s*\|\s*'([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+)'/gm)) ids.add(match[1]);
    for (const match of text.matchAll(/type \w*FlagId =\s*((?:'[^']+'\s*\|?\s*)+)/g)) {
      for (const id of match[1].matchAll(ID)) ids.add(id[1]);
    }
  }
  return ids;
}

/** A flag is read when its id appears as a literal, or a file builds ids from its prefix and names its suffix. */
function isRead(id: string): boolean {
  const [prefix, suffix] = id.split('.');
  return texts.some(
    (text) =>
      text.includes(`'${id}'`) ||
      text.includes(`"${id}"`) ||
      (text.includes(`\`${prefix}.\${`) && text.includes(`'${suffix}'`)),
  );
}

describe('flag usage', () => {
  const defined = new Set(FLAGS.map((def) => def.id as string));

  it('finds the sources it scans', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(flagFiles.length).toBeGreaterThan(5);
    expect(texts.length).toBeGreaterThan(files.length - flagFiles.length);
  });

  it('defines every FlagId', () => {
    const ids = declared();
    expect(ids.size).toBeGreaterThan(100);
    expect([...ids].filter((id) => !defined.has(id))).toEqual([]);
  });

  it('registers every flag once', () => {
    expect(FLAGS.length).toBe(defined.size);
  });

  it('reads every registered flag, or lists it as waiting for its feature', () => {
    const unread = [...defined].filter((id) => !isRead(id) && !(id in WAITING));
    expect(unread.map((id) => `${id} is registered but nothing reads it`)).toEqual([]);
  });

  it('lists only flags that are registered', () => {
    expect(Object.keys(WAITING).filter((id) => !defined.has(id))).toEqual([]);
  });
});
