// Runtime packs (ADR 0070) and installed toolchains (ADR 0071). Lane code:L18 downloads and serves packs; lane
// code:L16 detects toolchains and keeps consent. The Tauri commands answer in these shapes (camelCase).

/** Packs downloaded on request. A Pyodide package is a pack of its own, named `pyodide:<package>`. */
export type PackId = 'pyodide' | 'clang' | 'ruby' | 'webr' | 'code-tools' | `pyodide:${string}`;

/** Where a pack stands on this device. `blocked` is Work offline or safe mode. */
export type PackState =
  | { kind: 'absent' }
  | { kind: 'downloading'; receivedBytes: number; totalBytes: number }
  | { kind: 'ready'; bytes: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'blocked'; reason: 'offline' | 'safe-mode' };

/** A catalog entry as the download dialog shows it: the exact size and license before any byte moves. */
export interface PackInfo {
  id: PackId;
  version: string;
  bytes: number;
  license: string;
  state: PackState;
}

/** Languages that run through the person's installed toolchains (DESIGN 2.2). */
export type ToolchainLanguage =
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'swift'
  | 'c'
  | 'cpp'
  | 'bash'
  | 'powershell'
  | 'node'
  | 'deno'
  | 'dart'
  | 'python'
  | 'php'
  | 'ruby'
  | 'r'
  | 'lua'
  | 'julia';

/** What identifies an executable. Consent is asked again when any field changes. */
export interface ExecutableFingerprint {
  path: string;
  bytes: number;
  modifiedMs: number;
}

/**
 * One detected toolchain. `network` says whether a program can reach the internet: `blocked` inside an
 * AppContainer, `reachable` for per-user installs and WSL, which the consent screen states.
 */
export interface ToolchainInfo {
  language: ToolchainLanguage;
  version: string;
  executable: ExecutableFingerprint;
  network: 'blocked' | 'reachable';
}

/** The person's yes for one language on this device. Kept in device state, never in the notebook. */
export interface Consent {
  language: ToolchainLanguage;
  executable: ExecutableFingerprint;
  network: 'blocked' | 'reachable';
  /** ISO 8601 time of the yes. */
  grantedAt: string;
}
