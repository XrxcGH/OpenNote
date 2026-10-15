// Two-way sync of tasks with Microsoft To Do and Google Tasks: the fields that are kept in step, in one shape for both
// services and for the Upcoming list.

/** What is kept in step: the title, the box, the due date, and the time of day (To Do's reminder). */
export interface TaskFields {
  title: string;
  done: boolean;
  /** The due date as YYYY-MM-DD, or null. */
  date: string | null;
  /** The time of day as HH:MM in the viewer's zone, or null. On To Do this is the reminder. */
  time: string | null;
}

export interface LocalTask extends TaskFields {
  id: string;
}

export interface RemoteTask extends TaskFields {
  id: string;
  /** When the service last changed it, as an ISO time. */
  updated: string;
}

export interface TasksApi {
  service: 'microsoft' | 'google';
  label: string;
  /** Every task of the default list, finished ones too. */
  list(): Promise<RemoteTask[]>;
  create(fields: TaskFields): Promise<RemoteTask>;
  update(id: string, fields: TaskFields): Promise<RemoteTask>;
  remove(id: string): Promise<void>;
}

/** The person's own tasks on this device. */
export interface LocalTasks {
  read(): LocalTask[];
  /** Adds or replaces tasks by ID, and removes the others named. */
  write(put: readonly LocalTask[], remove: readonly string[]): void;
  /** When the task was last changed here, if the list knows. */
  modifiedAt?(id: string): number | null;
}

/** A task changed in both places between two syncs. The newer change was kept. */
export interface Conflict {
  at: string;
  title: string;
  kept: 'here' | 'there';
  /** What the other copy said, so nothing is lost without a record. */
  other: TaskFields;
}

export interface Link {
  remote: string;
  /** What both sides held after the last sync. */
  base: TaskFields;
}

export interface TasksState {
  links: Record<string, Link>;
  conflicts: Conflict[];
  lastSync: string | null;
  /** When this device's change was first noticed, for a task that has not synced yet. */
  seen: Record<string, number>;
}

export const EMPTY_STATE: TasksState = { links: {}, conflicts: [], lastSync: null, seen: {} };

export interface SyncResult {
  pulled: number;
  pushed: number;
  removed: number;
  conflicts: number;
}
