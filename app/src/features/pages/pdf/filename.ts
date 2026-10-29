// File names for exports. A page title can hold any character, but a file name on Windows cannot hold some of them, and
// some whole names are reserved. This makes a name that every file system accepts and a person can still read.

const FORBIDDEN = new RegExp('[<>:"/\\\\|?*' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g');
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** The longest stem, in characters, so the full path stays under the limits of older tools. */
export const MAX_STEM = 120;

/** A safe file name stem for a page title. `fallback` is used for an empty title. */
export function fileStem(title: string, fallback = 'Untitled'): string {
  let stem = title
    .normalize('NFC')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (Array.from(stem).length > MAX_STEM) stem = Array.from(stem).slice(0, MAX_STEM).join('').trimEnd();
  stem = stem.replace(/[. ]+$/, '');
  if (stem === '') return fallback;
  return RESERVED.test(stem.split('.')[0]) ? `${stem}_` : stem;
}

/** A name for an exported file: the stem and an extension without its dot. */
export function exportFileName(
  title: string,
  extension: 'pdf' | 'md' | 'html' | 'png' | 'svg' | 'docx',
  fallback?: string,
): string {
  return `${fileStem(title, fallback)}.${extension}`;
}
