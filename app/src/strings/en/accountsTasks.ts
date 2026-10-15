// Two-way sync of tasks with Microsoft To Do and Google Tasks.

export const accountsTasks = {
  commands: {
    microsoft: 'Sync tasks with Microsoft To Do',
    google: 'Sync tasks with Google Tasks',
    log: 'Show task sync changes made in both places',
    keywords: 'tasks sync to do todo google microsoft upcoming checkbox due reminder',
  },
  working: 'Syncing tasks with {service}…',
  upToDate: 'Your tasks and {service} already match.',
  done: 'Synced with {service}. {pulled} came here, {pushed} went there, {removed} removed.',
  conflicts:
    '{count, plural, one {# task was changed in both places. The newer change was kept, and the other is in the sync log.} other {# tasks were changed in both places. The newer change was kept, and the others are in the sync log.}}',
  log: {
    title: 'Task sync log',
    description:
      'Tasks that were changed here and there between two syncs. The newer change was kept. This shows what the other copy said.',
    close: 'Close',
    none: 'Nothing has been changed in both places.',
    entry: '{service}, {when}. Kept the one {kept}. The other said: {other}',
    keptHere: 'here',
    keptThere: 'there',
    done: 'done',
  },
} as const;
