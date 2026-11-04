// The string namespaces that each release's lanes name. shared:x-shared registers them at the start of a release,
// so a lane that fills its file never edits the index. Each later run adds that release's namespaces here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '.';

/** Namespace to its owning lane, per release. */
const RELEASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  B9: {
    sheetModel: 'tables:sheet-model',
    numfmt: 'tables:numfmt',
  },
  B10: {
    color: 'shared:x-palette',
    fnDateTime: 'tables:fn-datetime',
    fnLogicInfo: 'tables:fn-logic-info',
    fnLookup: 'tables:fn-lookup',
    fnMath: 'tables:fn-math',
    fnText: 'tables:fn-text',
    sheetKeys: 'tables:keys',
    sheetFormula: 'tables:formula-bar',
    sheetToolbar: 'tables:toolbar',
    textPaste: 'text:clipboard',
    textCommands: 'text:editor-commands',
    textFonts: 'text:fonts-ui',
    textStyles: 'text:styles',
    textHome: 'text:home-tab-ui',
  },
  B11: {
    sheetConditional: 'tables:conditional',
    fnArrays: 'tables:fn-arrays',
    fnFinance: 'tables:fn-finance',
    fnStats: 'tables:fn-stats',
    sheetFormat: 'tables:format-dialog',
    sheetMerge: 'tables:merge',
    sheetValidation: 'tables:validation',
    sheetTools: 'tables:data-tools',
    textFind: 'text:find-format',
    textPane: 'text:format-pane',
    textLanguage: 'text:language-direction',
    textRuler: 'text:ruler',
    textSymbols: 'text:special-chars',
    'codeStudio.editor': 'code:L01',
    'codeStudio.project': 'code:L02',
    'codeStudio.run': 'code:L03',
    'codeStudio.packs': 'code:L18',
  },
  /** Registered in Beta 11, because the code studio's tool window entry needs its title. */
  B12: {
    'codeStudio.studio': 'code:L04',
  },
};

/** The dotted paths of every leaf that is not a non-empty string. */
function missing(value: unknown, path: string): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [path] : [];
  if (value === null || typeof value !== 'object') return [path];
  return Object.entries(value).flatMap(([key, child]) => missing(child, `${path}.${key}`));
}

const index = en as unknown as Record<string, unknown>;

/** The namespace at a dotted name, such as codeStudio.editor for the file codeStudio/editor.ts. */
const at = (name: string): unknown =>
  name.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], index);

describe.each(Object.entries(RELEASES))('the %s namespaces', (_release, namespaces) => {
  it.each(Object.entries(namespaces))('registers %s, owned by %s, with no missing keys', (name, lane) => {
    expect(at(name), name).toBeTypeOf('object');
    expect(missing(at(name), name)).toEqual([]);
    const header = readFileSync(join(import.meta.dirname, `${name.replaceAll('.', '/')}.ts`), 'utf8')
      .split('\n')
      .slice(0, 3)
      .join('\n');
    expect(header).toContain(`Owner: ${lane}`);
  });
});
