// The flag of the Connectors page in Settings. It is on in every channel because the page works end to end: a
// connector with no client ID says "Needs setup" and nothing signs in until the person asks. app/flags.ts joins
// this list to the others.
import type { FlagDef, FlagId } from '../../app/flags';

export type ConnectorsFlagId = Extract<FlagId, `connectors.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: ConnectorsFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: on,
});

export const CONNECTORS_FLAGS: readonly FlagDef[] = [
  flag('connectors.page', 'The Connectors section of Settings: sign in to the accounts that some features use.'),
];
