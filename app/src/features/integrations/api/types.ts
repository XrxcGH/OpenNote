// The local API as App permissions sees it (docs/help/local-api.md). The shapes match crates/api: grants.rs,
// access_log.rs, backend.rs, and webhooks.rs, as the shell's `api_call` command returns them. No shape here ever
// holds a token or a webhook's signing secret.

export type AppKind = 'app' | 'cli' | 'assistant' | 'clipper' | 'mail';

/** What a grant may do. `addPages` sees names only and adds new pages: the clipper and the mail add-ins. */
export type Access = 'read' | 'readWrite' | 'addPages';

export type Scope = { kind: 'all' } | { kind: 'notebooks'; ids: string[] };

export interface AppGrant {
  id: string;
  name: string;
  kind: AppKind;
  /** Unix seconds. */
  created: number;
  lastUsed?: number | null;
  access: Access;
  askBeforeWrites: boolean;
  notebooks: Scope;
  origin?: string | null;
}

export type Outcome = 'allowed' | 'refused' | 'failed';

export interface LogEntry {
  /** Unix milliseconds. */
  time: number;
  app: string;
  name: string;
  action: string;
  target?: string;
  title?: string;
  outcome: Outcome;
  detail?: string;
}

export interface ApiStatus {
  /** The api.local flag. Off means no listener and no page. */
  available: boolean;
  /** "Let apps on this PC connect". */
  enabled: boolean;
  running: boolean;
  port: number | null;
  pipe: string | null;
}

export type Question =
  { kind: 'connect'; appKind: AppKind; wants: Access } | { kind: 'change'; action: string; target: string };

export interface ApprovalRequest {
  id: string;
  appName: string;
  question: Question;
}

export type Decision = { kind: 'allow'; access?: Access; notebooks?: Scope; always?: boolean } | { kind: 'deny' };

export interface PairCode {
  code: string;
  port: number;
  /** Unix milliseconds. */
  expiresAt: number;
}

export type HookEvent = 'pageCreated' | 'pageChanged' | 'tagAdded';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: HookEvent[];
  notebooks: Scope;
  includeText: boolean;
  enabled: boolean;
}

/** What the shell sends on `api://event`. */
export type ApiEvent =
  | { kind: 'question'; request: ApprovalRequest }
  | { kind: 'answered'; id: string }
  | { kind: 'changed'; what: 'grants' | 'log' | 'status' | 'webhooks' };
