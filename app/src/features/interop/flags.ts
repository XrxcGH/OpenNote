// Phase 11's flags (docs/DEVELOPMENT.md, Phase 11). Both features work from the first dialog to the finished
// notebook or file, so they are on in every channel. app/flags.ts joins these to the other lists.
import type { FlagDef, FlagId } from '../../app/flags';

export type InteropFlagId = Extract<FlagId, `interop.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };
const off = { dev: false, nightly: false, beta: false, stable: false };

const flag = (id: InteropFlagId, description: string, enabled: FlagDef['enabled'] = on): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const INTEROP_FLAGS: readonly FlagDef[] = [
  flag('interop.import', 'Import notes from other apps, with a check of what will and will not come over.'),
  flag('interop.export', 'Export a page, section, or notebook to Markdown, web pages, or Word.'),
  flag('interop.exportPdf', 'The PDF choice in Export. Off until the PDF writer of Phase 6 is in.', off),
];
