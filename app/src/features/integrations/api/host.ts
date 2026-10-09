// Where App permissions reaches the shell. The Tauri build calls the one `api_call` command and listens on
// `api://event`; the web build and the tests use the in-memory fake below, so the page runs in a browser.

import type { ApiEvent, ApiStatus, AppGrant, ApprovalRequest, Decision, LogEntry, PairCode, Webhook } from './types';

export interface ApiHost {
  call<T>(method: string, args?: Record<string, unknown>): Promise<T>;
  /** Listens for the shell's events. The returned function stops listening. */
  listen(handler: (event: ApiEvent) => void): () => void;
}

/** The fake's state, which tests read and change. */
export interface FakeApiState {
  status: ApiStatus;
  apps: AppGrant[];
  log: LogEntry[];
  pending: ApprovalRequest[];
  decided: { id: string; decision: Decision }[];
  webhooks: Webhook[];
  /** Webhook secrets are never sent back; the fake only counts that one was set. */
  secretsSet: string[];
  code: PairCode | null;
  copied: string | null;
  cli: { installed: boolean; onPath: boolean; folder: string };
}

export interface FakeApi {
  host: ApiHost;
  state: FakeApiState;
  emit(event: ApiEvent): void;
  /** Puts a question up, as an app asking would. */
  ask(request: ApprovalRequest): void;
}

let seq = 0;

/** An in-memory host. */
// checks-disable-next-line modifiability: one hook whose parts share its state; split it when it grows again
export function createFakeApi(initial: Partial<FakeApiState> = {}): FakeApi {
  const state: FakeApiState = {
    status: { available: true, enabled: true, running: true, port: 49_321, pipe: 'OpenNote-api-fake' },
    apps: [],
    log: [],
    pending: [],
    decided: [],
    webhooks: [],
    secretsSet: [],
    code: null,
    copied: null,
    cli: { installed: true, onPath: false, folder: String.raw`C:\OpenNote\bin` },
    ...initial,
  };
  const listeners = new Set<(event: ApiEvent) => void>();
  const emit = (event: ApiEvent) => [...listeners].forEach((listener) => listener(event));
  const answer = (method: string, args: Record<string, unknown>): unknown => {
    switch (method) {
      case 'status':
        return { ...state.status };
      case 'setEnabled': {
        const enabled = Boolean(args.enabled);
        state.status = { ...state.status, enabled, running: enabled && state.status.available };
        return { ...state.status };
      }
      case 'apps':
        return state.apps.map((app) => ({ ...app }));
      case 'updateApp': {
        const change = args as unknown as Pick<AppGrant, 'id' | 'access' | 'notebooks' | 'askBeforeWrites'>;
        const app = state.apps.find((one) => one.id === change.id);
        if (!app) return false;
        Object.assign(app, {
          access: change.access,
          notebooks: change.notebooks,
          askBeforeWrites: change.askBeforeWrites,
        });
        return true;
      }
      case 'revoke': {
        const before = state.apps.length;
        state.apps = state.apps.filter((app) => app.id !== args.id);
        state.log.unshift({ time: Date.now(), app: String(args.id), name: '', action: 'revoke', outcome: 'allowed' });
        return before !== state.apps.length;
      }
      case 'log':
        return state.log.slice(0, Number(args.limit ?? 200));
      case 'clearLog':
        state.log = [];
        return null;
      case 'pending':
        return [...state.pending];
      case 'decide': {
        const id = String(args.id);
        const waiting = state.pending.some((request) => request.id === id);
        state.pending = state.pending.filter((request) => request.id !== id);
        if (waiting) state.decided.push({ id, decision: args.decision as Decision });
        return waiting;
      }
      case 'pairCode':
        if (!state.status.running) throw Object.assign(new Error('notRunning'), { code: 'notRunning' });
        state.code = { code: 'K7Q2-M9XD', port: state.status.port ?? 0, expiresAt: Date.now() + 10 * 60_000 };
        return { ...state.code };
      case 'cancelCode':
        state.code = null;
        return null;
      case 'mcpConfig':
        return {
          config: JSON.stringify(
            { mcpServers: { opennote: { command: 'C:\\OpenNote\\bin\\opennote.exe', args: ['mcp'] } } },
            null,
            2,
          ),
          toolInstalled: true,
        };
      case 'cliStatus':
        return { ...state.cli };
      case 'setCliPath':
        state.cli = { ...state.cli, onPath: Boolean(args.on) && state.cli.installed };
        return { ...state.cli };
      case 'webhooks':
        return state.webhooks.map((hook) => ({ ...hook }));
      case 'saveWebhook': {
        const hook = args.hook as Webhook;
        if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(hook.url)) throw Object.assign(new Error('url'), { code: 'invalid' });
        const id = hook.id || `hook${(seq += 1)}`;
        const saved = { ...hook, id };
        state.webhooks = [...state.webhooks.filter((one) => one.id !== id), saved];
        const typed = typeof args.secret === 'string' && args.secret !== '';
        if (typed) state.secretsSet.push(id);
        return { hook: saved, newSecret: !hook.id && !typed ? 'f'.repeat(8) : null };
      }
      case 'deleteWebhook':
        state.webhooks = state.webhooks.filter((hook) => hook.id !== args.id);
        return true;
      case 'testWebhook':
        return { status: 200 };
      default:
        return null;
    }
  };
  return {
    state,
    emit,
    ask(request) {
      state.pending.push(request);
      emit({ kind: 'question', request });
    },
    host: {
      call: <T>(method: string, args: Record<string, unknown> = {}) => {
        try {
          return Promise.resolve(answer(method, args) as T);
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      listen(handler) {
        listeners.add(handler);
        return () => void listeners.delete(handler);
      },
    },
  };
}

let host: ApiHost | null = null;
let fallback: FakeApi | null = null;

/**
 * The web build's fake, made on first use. Playwright and `npm run app:dev` choose what it starts with:
 *   ?api=demo   the opennote command is connected, and the log has a read and a refusal
 *   ?apiAsk     a program called "My script" is waiting to connect
 */
export function webFake(): FakeApi {
  if (fallback) return fallback;
  const search = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const initial: Partial<FakeApiState> = {};
  if (search.get('api') === 'demo') {
    const now = Date.now();
    initial.apps = [
      {
        id: '0123456789abcdef',
        name: 'opennote',
        kind: 'cli',
        created: Math.floor(now / 1000) - 86_400,
        lastUsed: Math.floor(now / 1000) - 600,
        access: 'read',
        askBeforeWrites: true,
        notebooks: { kind: 'all' },
      },
    ];
    initial.log = [
      { time: now - 600_000, app: '0123456789abcdef', name: 'opennote', action: 'search', outcome: 'allowed' },
      {
        time: now - 500_000,
        app: '0123456789abcdef',
        name: 'opennote',
        action: 'page.read',
        title: 'Private',
        outcome: 'refused',
        detail: 'locked',
      },
    ];
  }
  if (search.has('apiAsk')) {
    initial.pending = [
      { id: 'ask1', appName: 'My script', question: { kind: 'connect', appKind: 'app', wants: 'read' } },
    ];
  }
  return (fallback = createFakeApi(initial));
}

/** Uses `next` from now on, for tests. `null` goes back to the build's own host. */
export function setApiHost(next: ApiHost | null): void {
  host = next;
}

export function apiHost(): ApiHost {
  if (host) return host;
  if (import.meta.env.VITE_PLATFORM === 'web' || import.meta.env.MODE === 'test') return webFake().host;
  const lazy = import('../../../platform/tauri/localApi');
  host = {
    call: <T>(method: string, args?: Record<string, unknown>) =>
      lazy.then(({ tauriApiCall }) => tauriApiCall<T>(method, args ?? {})),
    listen(handler) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void lazy.then(({ tauriApiListen }) =>
        tauriApiListen((event) => handler(event as unknown as ApiEvent)).then((unlisten) => {
          if (stopped) unlisten();
          else stop = unlisten;
        }),
      );
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
  return host;
}

/** The error code a refused call carries, such as `notRunning`. */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return 'unknown';
}
