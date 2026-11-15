// SQL on SQLite and Lua: the two runtimes and their results.
// Owner: code:L07 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioSqlLua = {
  sql: {
    rows: '{count, plural, =0 {No rows.} one {1 row.} other {# rows.}}',
    changed: '{count, plural, one {1 row changed.} other {# rows changed.}}',
    cut: 'Only the first {count} rows are shown.',
    imported: '{count, plural, one {Imported 1 row into {table}.} other {Imported # rows into {table}.}}',
    importUsage: 'Use .import [--skip N] FILE TABLE.',
    importNoFile: 'The project has no file named {path}.',
    importBadRow: '{path} line {line} has {found} values, but {table} has {expected} columns.',
    importEmpty: '{path} is empty, so there is nothing to import.',
    unknownCommand: 'Unknown command {command}. Only .import works here.',
    noCodeFromText: 'Code cannot be made from text in a run.',
  },
  lua: {
    closedFile: 'attempt to use a closed file',
    badFd: 'Bad file descriptor',
    noModule: "no file '{path}' in the project",
    noFile: '{path}: No such file or directory',
    notWritable: '{path}: The project cannot be written here',
    formatBad: "bad argument #{index} to 'read' (invalid format)",
  },
} as const;
