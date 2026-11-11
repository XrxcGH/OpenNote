// The runtimes a run worker can load, one entry per adapter. Each runtime lane adds its own line here. The line is a
// lazy import, so a worker loads only the runtime it runs. The lanes: code:L05 (python), code:L06 (js), code:L07
// (sql, lua), code:L08 (cpp), and code:L09 (ruby, r).
// Until a runtime's line is here, a run of it ends as "failed" with the message "runtime".

import type { RuntimeId } from '../contracts/run';
import type { AdapterRegistry } from './serve';

export const ADAPTERS: AdapterRegistry = {
  javascript: () => import('../runtimes/js/adapter').then((loaded) => loaded.javascriptAdapter),
  typescript: () => import('../runtimes/js/adapter').then((loaded) => loaded.typescriptAdapter),
};

/**
 * The extra globals each runtime's lockdown keeps (RuntimeAdapter.allowances), in one place so the run tests can
 * check every one of them. Base64 helpers are plain functions. A name on lockdown's FORBIDDEN list is removed even
 * when it is listed here.
 */
export const ALLOWANCES: Record<RuntimeId, readonly string[]> = {
  'python-quick': [],
  'python-full': ['atob', 'btoa'],
  javascript: [],
  typescript: [],
  sql: [],
  lua: [],
  c: [],
  cpp: [],
  ruby: ['atob', 'btoa'],
  r: ['atob', 'btoa'],
};
