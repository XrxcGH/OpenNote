# SQL and Lua in code projects

A code project can hold SQL (.sql) or Lua (.lua) files and run them in the app. Both runtimes come with the app and work offline. Code projects are in testing and are off in this beta. See [Code studio](code-studio.md).

## SQL

SQL runs on SQLite 3.54, in a new database in memory for each run.

- The project's other .sql files run first: schema files, then seed files, then the rest by name. Then the main file runs.
- Each statement that gives rows shows them as a table. `EXPLAIN QUERY PLAN` also shows its plan as a tree.
- `.import data.csv people` loads a CSV file from the project into a table.
- An error stops the run at that statement, and names its line and column.
- While you type, SQLite checks each statement against the tables the project makes, so a wrong column name shows at once.

What does not work here: loading extensions, and files outside the project. The database is gone when the run ends.

## Lua

Lua is Lua 5.4 through wasmoon.

- `print` writes to the output. `io.read` reads the input you typed before the run.
- `require "util"` finds `util.lua` in the project.
- `math.random` follows the run's seed, so a run can repeat.
- A syntax error names its file and line, while you type and when you run.

What does not work here: `io.popen`, `os.execute`, `package.loadlib`, `string.dump`, and loading compiled code. A program cannot reach the page, other files, or the network.

## Limits

Each run has a time limit and a memory limit. Settings, then Code, sets them. A run that passes one ends with a clear status.
