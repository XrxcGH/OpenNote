// Flags of the extra import, export, and integration features (docs/FEATURES.md, Phase 11, and later). Each one works
// from its first screen to its result. The import and export ones are on in every channel; the platform ones are on
// in Beta. app/flags.ts joins this list to the others, and the shell reads the platform ones in platform_flags.rs.
import type { FlagDef } from '../../app/flags';

export type IntegrationsFlagId =
  | 'interop.officeFormats'
  | 'interop.snip'
  | 'interop.openFiles'
  | 'interop.sendToFolder'
  | 'interop.share'
  | 'api.local'
  | 'integrations.shareTarget'
  | 'integrations.phoneScan';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };
/** The platform features (local API, share target, phone scan) wait for Beta testers before Stable gets them. */
const betaBuilds = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: IntegrationsFlagId, description: string, enabled: FlagDef['enabled'] = on): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const INTEGRATIONS_FLAGS: readonly FlagDef[] = [
  flag('interop.officeFormats', 'Excel, PowerPoint, and CSV choices in Export.'),
  flag('interop.snip', 'Offer to add a screenshot from the Snipping Tool to the open page.'),
  flag('interop.openFiles', 'Open a single Markdown or text file as a page that saves back to the file.'),
  flag('interop.sendToFolder', 'Send a copy of a page, section, or notebook to a folder, with favorites.'),
  flag('interop.share', 'Share a page, section, or notebook as one file that opens as a new notebook.'),
  flag(
    'api.local',
    'The local API on this PC, with app permissions, an access log, the opennote tool, and the MCP server.',
    betaBuilds,
  ),
  flag(
    'integrations.shareTarget',
    'Share to OpenNote from other apps, once the app has its package identity.',
    betaBuilds,
  ),
  flag(
    'integrations.phoneScan',
    'Insert > From phone: send photos from a phone on the same network with a QR code.',
    betaBuilds,
  ),
];
