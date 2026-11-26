# Python in code projects

A code project can hold Python (.py) files and run them in the app. Code projects are in testing and are off in this beta.

## Quick and full Python

- Quick Python is MicroPython 1.27. It comes with the app and starts at once. It knows most of the language, but not every module or newer form.
- Full Python is CPython 3.14 through Pyodide. It comes in a runtime pack you download once, in Settings, under Code downloads. Without the pack, a run says the pack is missing.

## Run a program

- The main file runs with the project files beside it. `import util` finds `util.py` in the main file's folder.
- `print` writes to the output. `sys.argv` holds the arguments, and `random.seed` comes from the run settings, so a run can repeat.
- `input()` reads the input you typed before the run. When it runs out, `input()` raises EOFError, and the output says the input ended. A program cannot wait for typing yet.
- `sys.exit(n)` ends the run with exit code n.
- Files the program writes stay in the project.
- Each run has a time limit and a memory limit. Memory and written files both count toward the memory limit. A program that asks for more gets MemoryError, or OSError when a file grows too large.

## Errors

- A traceback names your file and line, not the app's own setup code.
- Full Python's messages include hints such as "Did you mean: 'print'?" and "Did you forget to import 'math'?".

## What does not work here

- The network, packages from PyPI, and the `js` and `pyodide` modules. They are refused, so a program cannot reach the page or the internet.
- Files outside the project. Only the project's own folder is readable, besides Python's own library.
- Interactive input while the program runs. Type the input before you run.
