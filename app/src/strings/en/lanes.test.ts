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
    textPane: 'text:format-pane',
    textRuler: 'text:ruler',
    textSymbols: 'text:special-chars',
    textLanguage: 'text:language-direction',
    textNotes: 'text:footnotes',
    textReview: 'text:review',
    textLayout: 'text:page-layout',
    textFind: 'text:find-format',
  },
};

/** The dotted paths of every leaf that is not a non-empty string. */
function missing(value: unknown, path: string): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [path] : [];
  if (value === null || typeof value !== 'object') return [path];
  return Object.entries(value).flatMap(([key, child]) => missing(child, `${path}.${key}`));
}

const index = en as unknown as Record<string, unknown>;

describe.each(Object.entries(RELEASES))('the %s namespaces', (_release, namespaces) => {
  it.each(Object.entries(namespaces))('registers %s, owned by %s, with no missing keys', (name, lane) => {
    expect(index[name], name).toBeTypeOf('object');
    expect(missing(index[name], name)).toEqual([]);
    const header = readFileSync(join(import.meta.dirname, `${name}.ts`), 'utf8')
      .split('\n')
      .slice(0, 3)
      .join('\n');
    expect(header).toContain(`Owner: ${lane}`);
  });
});
