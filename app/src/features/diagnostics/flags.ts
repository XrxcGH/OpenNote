// Phase 13's flags, from the hardening and beta phase in docs/DEVELOPMENT.md. app/flags.ts joins these to its list,
// so they load at start-up. Each is on in every channel because the feature works end to end. None sends anything
// by itself.
import type { FlagDef, FlagId } from '../../app/flags';

export type DiagnosticsFlagId = Extract<FlagId, `diagnostics.${string}` | `privacy.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: DiagnosticsFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: on,
});

export const DIAGNOSTICS_FLAGS: readonly FlagDef[] = [
  flag('privacy.panel', 'The Privacy section of Settings: network use, crash reports, and the saved reports.'),
  flag('privacy.workOffline', 'Work offline, which blocks every network use, and the notice in the title bar.'),
  flag('diagnostics.crashReports', 'Crash reports saved on this computer after a yes, with the consent screen.'),
  flag('diagnostics.selfCheck', 'The Help section of Settings and the Check OpenNote command.'),
  flag('diagnostics.feedback', 'Send feedback: a file shown in full before it is saved.'),
  flag('diagnostics.safeStart', 'The safe start offer after two crashes in a row, and the safe mode notice.'),
];
