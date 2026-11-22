// Code cells: small Python and JavaScript programs that run on this device in a sandbox (features/codecells).
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
  safety:
    'Runs on this device with no network, no files, and no access to your notes, for up to {seconds} seconds and {megabytes} MB.',
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
  starter: {
    python: `# Newton’s method for the square root of 2
x = 1.0
for step in range(6):
    x = x - (x * x - 2) / (2 * x)
    print(step, x)
`,
    javascript: `// Newton’s method for the square root of 2
// No braces here: the message formatter reads them as placeholders.
let x = 1;
const next = (v) => v - (v * v - 2) / (2 * v);
for (let step = 0; step < 6; step++) console.log(step, (x = next(x)));
`,
    typescript: `// Newton’s method for the square root of 2
const next = (v: number): number => v - (v * v - 2) / (2 * v);
let x = 1;
for (let step = 0; step < 6; step++) console.log(step, (x = next(x)));
`,
    sql: `-- The squares of 1 to 5, and their sum
WITH n(i) AS (VALUES (1), (2), (3), (4), (5))
SELECT i, i * i AS square, SUM(i * i) OVER () AS total FROM n;
`,
    lua: `-- Newton’s method for the square root of 2
local x = 1.0
for step = 0, 5 do
  x = x - (x * x - 2) / (2 * x)
  print(step, x)
end
`,
  },
} as const;
