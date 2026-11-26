// The shape of the key scope fixtures that commands/scopes.test.ts reads. Each program's key lane owns one fixture
// file. The test loads them all at once, so a chord that two programs bind in the same scope fails in whichever
// lane merges second. Owner: shared:x-shared.
import type { CommandId, KeymapPresetId, KeyScope } from '../../types';

/** A stand-in for a command: only what the dispatcher reads to choose one. */
export interface ScopeCommand {
  id: CommandId;
  /** Default 'global'. */
  scope?: KeyScope;
  keys?: readonly string[];
  presetKeys?: { readonly [P in KeymapPresetId]?: readonly string[] };
  refines?: CommandId;
}

/** One key press and the command it must run. */
export interface ScopeCase {
  chord: string;
  /** The innermost active scope. The test nests an element in every scope around it. */
  at: KeyScope;
  /** Default 'default', the Word set. */
  preset?: KeymapPresetId;
  /** Commands whose `enabled` is false for this press, so the key falls through. */
  disabled?: readonly CommandId[];
  /** The command that runs, or null when no command takes the key. */
  expect: CommandId | null;
  /** Why, in a few words, for the failure message. */
  why: string;
}

export interface ScopeFixture {
  program: string;
  /** The lane that owns the fixture file. */
  owner: string;
  commands: readonly ScopeCommand[];
  cases: readonly ScopeCase[];
}
