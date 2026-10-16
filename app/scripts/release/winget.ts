// Writes the three winget manifest files for a stable release, ready to submit to the winget-pkgs repository. The
// exes are plain portable programs, so winget installs each one as a `portable` package. The download addresses,
// sizes, and hashes come from the manifest that write-manifest.ts wrote, so winget and the updater always agree.
// Usage: node app/scripts/release/winget.ts <release-dir> <tag> <out-dir>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_FILES, versionOf, type Manifest } from '../write-manifest.ts';
import { manifestName } from './verify.ts';

const SCHEMA_VERSION = '1.6.0';
const ARCHITECTURES: Record<string, string> = {
  'windows-x86_64': 'x64',
  'windows-i686': 'x86',
  'windows-aarch64': 'arm64',
};

/** The package details that app/winget.json holds. */
export interface WingetConfig {
  PackageIdentifier: string;
  PackageName: string;
  Publisher: string;
  PublisherUrl: string;
  PackageUrl: string;
  License: string;
  LicenseUrl: string;
  ShortDescription: string;
  Moniker: string;
  Command: string;
  Tags: string[];
}

export const CONFIG_PATH = join(import.meta.dirname, '..', '..', 'winget.json');

/** A YAML value. A string is written bare when that is safe, and in double quotes when it is not. */
export function scalar(value: string | number): string {
  const text = String(value);
  const plain = /^[A-Za-z][A-Za-z0-9 ._()/+-]*$/.test(text) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(text);
  const dotted = /^\d+(\.\d+){2,}(-[A-Za-z0-9.-]+)?$/.test(text);
  return plain || dotted ? text : JSON.stringify(text);
}

/** The text of a multi-line value as a YAML block, so line breaks and colons need no escaping. */
function block(key: string, text: string): string {
  const body = text.split('\n').map((line) => (line === '' ? '' : `  ${line}`));
  return [`${key}: |-`, ...body].join('\n');
}

/** Everything wrong with the package details, in a sentence each. The rules follow winget's manifest schema. */
export function configProblems(config: WingetConfig): string[] {
  const problems: string[] = [];
  const id = /^[^.\s\\/:*?"<>|]{1,32}(\.[^.\s\\/:*?"<>|]{1,32}){1,7}$/;
  const hasControl = [...config.PackageIdentifier].some((char) => char.charCodeAt(0) < 32);
  if (!id.test(config.PackageIdentifier) || hasControl) {
    problems.push(`"${config.PackageIdentifier}" is not a valid PackageIdentifier.`);
  }
  if (config.ShortDescription.length > 256) problems.push('ShortDescription is longer than 256 characters.');
  if (config.Tags.length > 16 || config.Tags.some((tag) => tag.length > 40))
    problems.push('Tags are limited to 16, of 40 characters each.');
  for (const key of ['PublisherUrl', 'PackageUrl', 'LicenseUrl'] as const) {
    if (!config[key].startsWith('https://')) problems.push(`${key} must be an https address.`);
  }
  return problems;
}

function versionFile(config: WingetConfig, version: string): string {
  return [
    `PackageIdentifier: ${config.PackageIdentifier}`,
    `PackageVersion: ${scalar(version)}`,
    'DefaultLocale: en-US',
    'ManifestType: version',
    `ManifestVersion: ${SCHEMA_VERSION}`,
    '',
  ].join('\n');
}

function installerFile(config: WingetConfig, manifest: Manifest, tag: string): string {
  const installers = RELEASE_FILES.flatMap(({ platform }) => {
    const entry = manifest.platforms[platform];
    if (!entry) throw new Error(`The manifest has no entry for ${platform}.`);
    return [
      `- Architecture: ${ARCHITECTURES[platform]}`,
      `  InstallerUrl: ${entry.url}`,
      `  InstallerSha256: ${entry.sha256.toUpperCase()}`,
    ];
  });
  return [
    `PackageIdentifier: ${config.PackageIdentifier}`,
    `PackageVersion: ${scalar(versionOf(tag))}`,
    'MinimumOSVersion: 10.0.0.0',
    'InstallerType: portable',
    'Commands:',
    `- ${scalar(config.Command)}`,
    `ReleaseDate: ${manifest.pub_date.slice(0, 10)}`,
    'Installers:',
    ...installers,
    'ManifestType: installer',
    `ManifestVersion: ${SCHEMA_VERSION}`,
    '',
  ].join('\n');
}

function localeFile(config: WingetConfig, manifest: Manifest, tag: string): string {
  const notesUrl = `${config.PackageUrl}/releases/tag/${tag}`;
  return [
    `PackageIdentifier: ${config.PackageIdentifier}`,
    `PackageVersion: ${scalar(versionOf(tag))}`,
    'PackageLocale: en-US',
    `Publisher: ${scalar(config.Publisher)}`,
    `PublisherUrl: ${config.PublisherUrl}`,
    `PackageName: ${scalar(config.PackageName)}`,
    `PackageUrl: ${config.PackageUrl}`,
    `License: ${scalar(config.License)}`,
    `LicenseUrl: ${config.LicenseUrl}`,
    `ShortDescription: ${scalar(config.ShortDescription)}`,
    `Moniker: ${scalar(config.Moniker)}`,
    'Tags:',
    ...config.Tags.map((tagName) => `- ${scalar(tagName)}`),
    block('ReleaseNotes', manifest.notes.trim()),
    `ReleaseNotesUrl: ${notesUrl}`,
    'ManifestType: defaultLocale',
    `ManifestVersion: ${SCHEMA_VERSION}`,
    '',
  ].join('\n');
}

/**
 * The three manifest files for a stable release, by the path winget-pkgs expects under its `manifests` folder.
 * It refuses a prerelease, because winget-pkgs is for stable versions, and a problem in the package details.
 */
export function wingetFiles(config: WingetConfig, manifest: Manifest, tag: string): Record<string, string> {
  const version = versionOf(tag);
  if (version.includes('-')) throw new Error(`${tag} is a prerelease. Only stable releases go in winget.`);
  const problems = configProblems(config);
  if (problems.length > 0) throw new Error(problems.join(' '));
  const id = config.PackageIdentifier;
  const folder = ['manifests', id[0].toLowerCase(), ...id.split('.'), version].join('/');
  return {
    [`${folder}/${id}.yaml`]: versionFile(config, version),
    [`${folder}/${id}.installer.yaml`]: installerFile(config, manifest, tag),
    [`${folder}/${id}.locale.en-US.yaml`]: localeFile(config, manifest, tag),
  };
}

function main(): void {
  const [dir, tag, out] = process.argv.slice(2);
  if (!dir || !tag || !out) throw new Error('Usage: node app/scripts/release/winget.ts <release-dir> <tag> <out-dir>');
  const manifest = JSON.parse(readFileSync(join(dir, manifestName(versionOf(tag))), 'utf8')) as Manifest;
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as WingetConfig;
  const files = wingetFiles(config, manifest, tag);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(out, path, '..'), { recursive: true });
    writeFileSync(join(out, path), text);
  }
  console.log(
    `Wrote ${Object.keys(files).length} winget files for ${config.PackageIdentifier} ${versionOf(tag)} into ${out}.`,
  );
}

if (import.meta.main) main();
