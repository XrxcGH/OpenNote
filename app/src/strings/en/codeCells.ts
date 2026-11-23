// Code cells: small programs in several languages that run on this device in a sandbox (features/codecells).
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const codeCells = {
  insert: 'Insert code cell',
  insertKeywords: 'code cell run python javascript program script calculate sandbox offline notebook',
  inserted: 'Code cell added. Write code, then press Run or Ctrl+Enter.',
  block: 'Code cell',
  language: 'Language',
  languages: {
    python: 'Python',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    sql: 'SQL',
    lua: 'Lua',
    c: 'C',
    cpp: 'C++',
  },
  engine: 'Python engine',
  engines: { 'python-quick': 'Quick (MicroPython)', 'python-full': 'Full (Pyodide)' },
  openStudio: 'Open in Code studio',
  openStudioCommand: 'Open code block in Code studio',
  studioConfirm: {
    title: 'Open this code in the Code studio?',
    body: 'The code cell becomes a code project with the same text. You can undo the change.',
    confirm: 'Open in Code studio',
  },
  studioOpened: 'Code cell converted to a code project. Opening the Code studio.',
  studioReadOnly: 'This page is read-only, so the code cannot be moved into a project.',
  studioNoBlock: 'Put the caret in a code cell or a code project first.',
  code: 'Code',
  newer: 'This code cell needs a newer version of OpenNote',
  storedLanguage: 'Language: {language}',
  codeHelp:
    'Tab indents and Shift+Tab outdents. Ctrl+Tab accepts a suggestion. Press Escape, then Tab, to move on. ' +
    'Ctrl+Enter runs the cell, and Escape stops it.',
  run: 'Run',
  stop: 'Stop',
  clear: 'Clear output',
  output: 'Output',
  noOutput: 'The cell ran and printed nothing.',
  safety: 'Runs on this device with no network, files, or notes, for up to {seconds} seconds and {megabytes} MB.',
  status: {
    starting: 'Starting {language}…',
    running: 'Running…',
    ok: 'Ran in {seconds} seconds.',
    error: 'The cell stopped with an error.',
    time: 'Stopped after {seconds} seconds, the time limit.',
    memory: 'Stopped: the cell used more than {megabytes} MB, the memory limit.',
    stopped: 'Stopped.',
    failed: 'The cell could not run. Try again.',
    runtime: 'This language cannot run in this version of OpenNote yet.',
    pack: 'This language needs a download first. Open Settings, then Code, then Downloads.',
    truncated: 'Only the first part of the output is shown.',
  },
  blocked: {
    files: 'The sandbox blocks this: a code cell cannot read or write files on this computer.',
    modules:
      'The sandbox blocks this: a code cell has no network and no installed packages, only the built-in modules.',
  },
} as const;
