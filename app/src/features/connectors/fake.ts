// An in-memory host for the Connectors page, for the web platform and the tests. Its catalog is the registry's own
// list (registry.fixture.json, which a Rust test keeps in step), so the page shows the same connectors, groups, and
// access it will with the real host. A sign-in waits until the test calls `finishSignIn`, `failSignIn`, or `cancel`,
// as the real browser sign-in waits for the person.

import catalog from './registry.fixture.json';
import type { ConnectorsClient } from './client';
import { ConnectorError } from './types';
import type {
  ConnectInput,
  ConnectorErrorCode,
  ConnectorInfo,
  ConnectorRequest,
  ConnectorResponse,
  RevokeOutcome,
} from './types';

export interface FakeOptions {
  /** The connectors that have a client ID, so they don't say "Needs setup". Default: none, as in a real build. */
  configured?: readonly string[] | 'all';
  /** Connectors that start out connected, with the account name. */
  connected?: Readonly<Record<string, string>>;
  /** Whether Work offline is on. */
  offline?: () => boolean;
  /** Finish every sign-in by itself after this many milliseconds, with this account. For the web build. */
  autoSignIn?: { afterMs: number; account: string };
  /** What disconnecting tells the person about the service. Default 'revoked'. */
  revoke?: RevokeOutcome;
  /** The answer to a request. Default: 200 with an empty JSON object. */
  respond?: (id: string, request: ConnectorRequest) => ConnectorResponse;
}

export interface FakeConnectors {
  readonly client: ConnectorsClient;
  /** The current state of every connector. */
  readonly items: ConnectorInfo[];
  /** What the page asked for, in order, such as 'connect:google' and 'disconnect:google'. */
  readonly calls: string[];
  /** The requests that features made, with the connector and the access they named. */
  readonly requests: { id: string; access: readonly string[]; request: ConnectorRequest }[];
  /** What was typed to connect, by connector. */
  readonly inputs: Record<string, ConnectInput | undefined>;
  finishSignIn(id: string, account: string): void;
  failSignIn(id: string, code: ConnectorErrorCode): void;
}

const NOW = 1_790_000_000;

const copy = (item: ConnectorInfo): ConnectorInfo => structuredClone(item);

/** The registry's list, with the connectors that are configured or already connected as the options say. */
function startingItems(options: FakeOptions): ConnectorInfo[] {
  const configured = options.configured ?? [];
  const items = (catalog as unknown as ConnectorInfo[]).map(copy);
  for (const item of items) {
    const account = options.connected?.[item.id];
    if (account !== undefined) item.state = { kind: 'connected', account, connectedUnix: NOW };
    else if (item.state.kind === 'needsSetup' && (configured === 'all' || configured.includes(item.id))) {
      item.state = { kind: 'notConnected' };
    }
  }
  return items;
}

/** Marks a connector as connected. A school's connector then talks to the school's server only. */
function markConnected(item: ConnectorInfo, account: string, input?: ConnectInput): ConnectorInfo {
  const address = input?.baseUrl
    ?.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  item.pending = false;
  item.baseUrl = address ? `https://${address}` : null;
  item.state = { kind: 'connected', account, connectedUnix: NOW };
  if (item.auth === 'tokenAndUrl' && item.baseUrl) item.hosts = [new URL(item.baseUrl).host];
  return copy(item);
}

/** What the real host checks about a pasted token and a school's address, before it asks the service. */
function connectWithToken(item: ConnectorInfo, input: ConnectInput): ConnectorInfo {
  const token = input.token?.trim() ?? '';
  if (token.length < 8 || /\s/.test(token)) throw new ConnectorError('badInput');
  if (item.auth === 'tokenAndUrl' && !input.baseUrl?.trim()) throw new ConnectorError('badInput');
  return markConnected(item, item.auth === 'tokenAndUrl' ? 'Sam Student' : '', input);
}

interface Waiting {
  resolve(account: string): void;
  reject(code: ConnectorErrorCode): void;
}

export function createFakeConnectors(options: FakeOptions = {}): FakeConnectors {
  const items = startingItems(options);
  const waiting = new Map<string, Waiting>();
  const calls: string[] = [];
  const requests: FakeConnectors['requests'] = [];
  const inputs: Record<string, ConnectInput | undefined> = {};
  const offline = () => options.offline?.() ?? false;
  const find = (id: string): ConnectorInfo => {
    const item = items.find((one) => one.id === id);
    if (!item) throw new ConnectorError('unknown');
    return item;
  };
  const finish = (id: string, account: string): void => {
    const entry = waiting.get(id);
    waiting.delete(id);
    entry?.resolve(account);
  };
  const fail = (id: string, code: ConnectorErrorCode): void => {
    const entry = waiting.get(id);
    waiting.delete(id);
    entry?.reject(code);
  };

  /** A sign-in on the service's own page: pending until the test (or the web build's timer) finishes it. */
  const signIn = (item: ConnectorInfo, input?: ConnectInput): Promise<ConnectorInfo> => {
    item.pending = true;
    return new Promise<ConnectorInfo>((resolve, reject) => {
      waiting.set(item.id, {
        resolve: (account) => resolve(markConnected(item, account, input)),
        reject: (code) => {
          item.pending = false;
          reject(new ConnectorError(code));
        },
      });
      if (options.autoSignIn)
        setTimeout(() => finish(item.id, options.autoSignIn?.account ?? ''), options.autoSignIn.afterMs);
    });
  };

  const client: ConnectorsClient = {
    list: () => Promise.resolve(items.map(copy)),
    connect(id, input) {
      calls.push(`connect:${id}`);
      inputs[id] = input;
      const item = find(id);
      if (offline()) return Promise.reject(new ConnectorError('offline'));
      if (item.state.kind === 'needsSetup') return Promise.reject(new ConnectorError('notConfigured'));
      if (waiting.has(id)) return Promise.reject(new ConnectorError('busy'));
      if (item.auth === 'oauth') return signIn(item, input);
      try {
        return Promise.resolve(connectWithToken(item, input ?? {}));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    cancel(id) {
      calls.push(`cancel:${id}`);
      fail(id, 'canceled');
      return Promise.resolve();
    },
    disconnect(id) {
      calls.push(`disconnect:${id}`);
      const item = find(id);
      item.state = { kind: 'notConnected' };
      item.baseUrl = null;
      return Promise.resolve({ view: copy(item), revoke: options.revoke ?? 'revoked' });
    },
    request(id, access, request) {
      requests.push({ id, access, request });
      const item = find(id);
      if (offline()) return Promise.reject(new ConnectorError('offline'));
      if (item.state.kind === 'expired') return Promise.reject(new ConnectorError('expired'));
      if (item.state.kind !== 'connected') return Promise.reject(new ConnectorError('notConnected'));
      // The real host refuses access the connector doesn't have; a feature that misspells one fails its test here.
      if (access.some((name) => !item.access.some((one) => one.capability === name))) {
        return Promise.reject(new ConnectorError('missingAccess'));
      }
      return Promise.resolve(
        options.respond?.(id, request) ?? { status: 200, contentType: 'application/json', body: '{}' },
      );
    },
  };

  return { client, items, calls, requests, inputs, finishSignIn: finish, failSignIn: fail };
}
