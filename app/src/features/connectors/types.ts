// What the host tells the Connectors page, and what the page can ask for. The shapes match what
// app/src-tauri/src/connectors sends (view.rs and commands.rs). No token, client ID, or code is in any of them: the
// host keeps those, and the page only ever learns the state of each connection.

export type ConnectorGroup = 'microsoft' | 'google' | 'storage' | 'learning' | 'other';

/** How the person signs in: on the service's own page, with a pasted token, or with a token and the school's address. */
export type AuthKind = 'oauth' | 'token' | 'tokenAndUrl';

export type ConnectorState =
  | { kind: 'notConnected' }
  /** An OAuth connector whose client ID has not been added yet. */
  | { kind: 'needsSetup' }
  | { kind: 'connected'; account: string; connectedUnix: number }
  /** The service refused to renew the sign-in, so the person connects again. */
  | { kind: 'expired'; account: string };

/** One thing OpenNote can do with the account, named by an ID the strings explain in plain words. */
export interface AccessInfo {
  capability: string;
  /** True when it lets OpenNote change something. */
  writes: boolean;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  group: ConnectorGroup;
  auth: AuthKind;
  /** The OpenNote features that use it, by feature ID. */
  features: string[];
  access: AccessInfo[];
  /** The hosts OpenNote talks to for it. */
  hosts: string[];
  state: ConnectorState;
  /** The school's address, when the connector has one. */
  baseUrl: string | null;
  /** A sign-in is waiting for the browser. */
  pending: boolean;
  lastUsedUnix: number | null;
}

/** What the person typed to connect. A token goes in here and nowhere else. */
export interface ConnectInput {
  baseUrl?: string;
  token?: string;
}

export type RevokeOutcome = 'nothing' | 'revoked' | 'notSupported' | 'skippedOffline' | 'failed';

export interface Disconnected {
  view: ConnectorInfo;
  revoke: RevokeOutcome;
}

/** A request for a feature to run against a service. The host adds the token, so there is no Authorization header. */
export interface ConnectorRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** A text body, such as JSON. */
  body?: string;
  contentType?: string;
  /** Form fields, for a service that takes its token in the form, such as Moodle. */
  form?: Record<string, string>;
}

export interface ConnectorResponse {
  status: number;
  contentType: string | null;
  body: string;
}

/** Why the host refused. Each code has a sentence in strings/en/connectors.ts. */
export type ConnectorErrorCode =
  | 'offline'
  | 'unknown'
  | 'notConfigured'
  | 'notConnected'
  | 'expired'
  | 'missingAccess'
  | 'busy'
  | 'canceled'
  | 'timedOut'
  | 'denied'
  | 'mismatch'
  | 'portInUse'
  | 'browserFailed'
  | 'network'
  | 'rejected'
  | 'badInput'
  | 'foreignHost'
  | 'storage';

export const ERROR_CODES: readonly ConnectorErrorCode[] = [
  'offline',
  'unknown',
  'notConfigured',
  'notConnected',
  'expired',
  'missingAccess',
  'busy',
  'canceled',
  'timedOut',
  'denied',
  'mismatch',
  'portInUse',
  'browserFailed',
  'network',
  'rejected',
  'badInput',
  'foreignHost',
  'storage',
];

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(code: ConnectorErrorCode) {
    super(code);
    this.name = 'ConnectorError';
    this.code = code;
  }
}
