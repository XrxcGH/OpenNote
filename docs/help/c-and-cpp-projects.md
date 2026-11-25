# C and C++ in code projects

A code project can hold C (.c) and C++ (.cpp) files with their headers, and compile and run them in the app. Code projects are in testing and are off in this beta. See [Code studio](code-studio.md).

## The compiler

- C and C++ use clang 22 from the clang runtime pack. Get the pack once from the studio's toolbar or in Settings, under Code downloads. Without it, a run says the pack is missing and offers Download and Cancel in the console.
- The program runs as WebAssembly in the run sandbox.
- C uses C17 and C++ uses C++20 unless Settings, then Code, picks another standard. Warnings (-Wall -Wextra) are on unless you turn them off there.

## Run a program

- Every source file of the language compiles together, and the main file names the program.
- The console first shows the compile step: the files, the clang version, the standard, and how long it took.
- `printf` and `std::cout` write to the output. `scanf`, `getchar`, and `std::cin` read the input you typed before the run.
- The arguments and the run's seed come from the run settings. `return n` from `main` or `exit(n)` sets the exit code.
- Files the program writes stay in the project. The project is the program's `/`, so `fopen("data.txt", "r")` reads a project file.

## Errors

- Compile errors and warnings name the project file, line, and column.
- While you type, clang checks the file about a second after you stop.
- A name from the standard library that is missing its `#include` gets a hint with the header, such as `<stdio.h>` for `printf` or `<vector>` for `std::vector`.
- A failed `assert` names its file and line.

## What does not work here

- Exceptions in C++. `throw` and `try` stop the compile with a clear message, since the pack's C++ library is built without them.
- Threads, sockets, and other system calls outside WASI.
- Files outside the project.
- A compile that takes longer than 60 seconds stops, and the program does not run. A C++ program with heavy standard headers can take several seconds to compile.

## Limits

Each run has a time limit and a memory limit. Settings, then Code, sets them. A run that passes one ends with a clear status.
