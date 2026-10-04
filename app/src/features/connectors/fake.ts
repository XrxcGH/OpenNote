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
  Disconnected,
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

function copy(item: ConnectorInfo): ConnectorInfo {
  return structuredClone(item);
}

export function createFakeConnectors(options: FakeOptions = {}): FakeConnectors {
  const configured = options.configured ?? [];
  const items = (catalog as unknown as ConnectorInfo[]).map(copy);
  for (const item of items) {
    const account = options.connected?.[item.id];
    if (account !== undefined) item.state = { kind: 'connected', account, connectedUnix: NOW };
    else if (item.state.kind === 'needsSetup' && (configured === 'all' || configured.includes(item.id))) {
      item.state = { kind: 'notConnected' };
    }
  }
  const find = (id: string): ConnectorInfo => {
    const item = items.find((one) => one.id === id);
    if (!item) throw new ConnectorError('unknown');
    return item;
  };
  const waiting = new Map<string, { resolve(account: string): void; reject(code: ConnectorErrorCode): void }>();
  const calls: string[] = [];
  const requests: FakeConnectors['requests'] = [];
  const inputs: Record<string, ConnectInput | undefined> = {};
  const offline = () => options.offline?.() ?? false;

  const signedIn = (item: ConnectorInfo, account: string, input?: ConnectInput): ConnectorInfo => {
    item.pending = false;
    item.baseUrl = input?.baseUrl ? `https://${input.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : null;
    item.state = { kind: 'connected', account, connectedUnix: NOW };
    // A school's connector talks to the school's server only.
    if (item.auth === 'tokenAndUrl' && item.baseUrl) item.hosts = [new URL(item.baseUrl).host];
    return copy(item);
  };

  const connectWithToken = (item: ConnectorInfo, input: ConnectInput): ConnectorInfo => {
    const token = input.token?.trim() ?? '';
    if (token.length < 8 || /\s/.test(token)) throw new ConnectorError('badInput');
    if (item.auth === 'tokenAndUrl' && !input.baseUrl?.trim()) throw new ConnectorError('badInput');
    return signedIn(item, item.auth === 'tokenAndUrl' ? 'Sam Student' : '', input);
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
      if (item.auth !== 'oauth') {
        try {
          return Promise.resolve(connectWithToken(item, input ?? {}));
        } catch (error) {
          return Promise.reject(error);
        }
      }
      item.pending = true;
      return new Promise<ConnectorInfo>((resolve, reject) => {
        waiting.set(id, {
          resolve: (account) => resolve(signedIn(item, account, input)),
          reject: (code) => {
            item.pending = false;
            reject(new ConnectorError(code));
          },
        });
        if (options.autoSignIn) {
          const { afterMs, account } = options.autoSignIn;
          setTimeout(() => finish(id, account), afterMs);
        }
      });
    },
    cancel(id) {
      calls.push(`cancel:${id}`);
      fail(id, 'canceled');
      return Promise.resolve();
    },
    disconnect(id): Promise<Disconnected> {
      calls.push(`disconnect:${id}`);
      const item = find(id);
      item.state = { kind: 'notConnected' };
      item.baseUrl = null;
      const revoke = options.revoke ?? 'revoked';
      return Promise.resolve({ view: copy(item), revoke });
    },
    request(id, access, request) {
      requests.push({ id, access, request });
      const item = find(id);
      if (offline()) return Promise.reject(new ConnectorError('offline'));
      if (item.state.kind === 'expired') return Promise.reject(new ConnectorError('expired'));
      if (item.state.kind !== 'connected') return Promise.reject(new ConnectorError('notConnected'));
      const answer = options.respond?.(id, request) ?? { status: 200, contentType: 'application/json', body: '{}' };
      return Promise.resolve(answer);
    },
  };

  function finish(id: string, account: string): void {
    const entry = waiting.get(id);
    waiting.delete(id);
    entry?.resolve(account);
  }
  function fail(id: string, code: ConnectorErrorCode): void {
    const entry = waiting.get(id);
    waiting.delete(id);
    entry?.reject(code);
  }

  return { client, items, calls, requests, inputs, finishSignIn: finish, failSignIn: fail };
}
