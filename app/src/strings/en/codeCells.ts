// Code cells: small Python and JavaScript programs that run on this device in a sandbox (features/codecells).
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const codeCells = {
  insert: 'Insert code cell',
  insertKeywords: 'code cell run python javascript program script calculate sandbox offline notebook',
  inserted: 'Code cell added. Write code, then press Run or Ctrl+Enter.',
  block: 'Code cell',
  language: 'Language',
  languages: { python: 'Python', javascript: 'JavaScript' },
  code: 'Code',
  codeHelp:
    'Tab indents and Shift+Tab outdents. Press Escape, then Tab, to move on. Ctrl+Enter runs the cell, and Escape stops it.',
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
    truncated: 'Only the first part of the output is shown.',
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
  },
} as const;
