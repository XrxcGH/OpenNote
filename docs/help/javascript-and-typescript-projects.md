# JavaScript and TypeScript in code projects

A code project can hold JavaScript (.js) and TypeScript (.ts) files and run them in the app. The runtime is QuickJS, and TypeScript is turned into JavaScript by Sucrase first. Code projects are in testing and are off in this beta.

## Run a program

- The main file runs as a script. The value of its last line is shown after an arrow, as in code cells.
- Use `console.log` or `print`. `console.warn` and `console.error` write to standard error. `readline()` and `prompt()` read standard input, and `process.argv` holds the arguments.
- Each run has a time limit and a memory limit. A run that passes one ends with a clear status.

## Modules

- Import another project file with a path that starts with `./` or `../`, as in `import { add } from './util';`. `.` and `..` name the index file of a folder.
- `./util.js` finds `util.ts`, as TypeScript does. JSON files can be imported too.
- Packages from npm are not available, and nothing can be downloaded.
- A file with no `import` or `export` runs as a plain script, in sloppy mode.

## Tests

Name a file `something.test.js` or `something.test.ts`, then run the tests.

- Write tests with `test` or `it`, group them with `describe`, and check values with `expect`. `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `.skip`, and `.todo` work.
- `.only` and `.each` are not supported. A file that uses them stops with a clear error.
- One run holds at most 500 tests. When a test passes the time or memory limit, the run stops. That test is marked, and the rest are marked as not run.

## What does not work here

These parts of TypeScript and JavaScript do not run. Each one stops with a message, or is listed here so it does not surprise you.

- A `namespace` or `module` block with code in it. Use a plain object or a separate file. A `declare namespace` with types only is fine.
- An `export` with several names in one statement, such as `export const a = 1, b = 2;`. Write one statement for each name.
- Decorators (`@name` before a class or a member). They stop with a syntax error.
- `.tsx` and `.jsx` files, since there is no JSX (the HTML-like syntax of React).
- `await` outside a function. Put the code in `async function main() { ... }` and call `main()`.
- A promise that rejects is reported only when it is the value of the last line. In `main(); console.log("done");`, an error thrown inside the async `main` is not shown. End the file with `main()` to see it, or catch the error.
- Type checking. Sucrase removes the types without checking them, so a type error does not stop the program.
