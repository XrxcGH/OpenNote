// C and C++: the compiler pack and the program runner.
// Owner: code:L08 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioCpp = {
  /** The run's status line when C or C++ is run but the compiler download is not on this device. */
  packMissing: 'C and C++ are not downloaded yet. Download them in Settings, under Code downloads.',
  /** The run's status line when the compiler did not load as it should. */
  startFailed: 'The C and C++ compiler did not start as expected.',
  phase: {
    /** The console line before the compile step. */
    compiling: 'Compiling {files} with clang {version} ({standard})…',
    /** The console line after a compile step that worked. */
    compiled: 'Compiled in {seconds} seconds. Running…',
    /** The console line after a compile step that failed. */
    failed: 'The compile step failed, so the program did not run.',
  },
  /** The run's status line when the project has no C or C++ source file to compile. */
  noSources: 'There is no C or C++ source file to compile.',
  /** The console line when the compiled program asks for something other than WASI. */
  foreignImport: 'The program asks for {name}, which a program here cannot use.',
  /** The console line when the program stopped at a trap, such as abort() or a failed assert. */
  trap: 'The program stopped: {reason}.',
  /** The run's status line when the compile step took longer than its limit, so the program did not run. */
  compileTime: 'The compile step took longer than {seconds} seconds, so the program did not run.',
  /** The run's status line when the compiler itself stopped, not the program. */
  compilerStopped: 'The compiler stopped unexpectedly, so the program did not run.',
  /** The run's status line after a compile step that failed. */
  compileFailed: 'The program did not compile. The errors are in the console.',
  /** The console line after a compile that failed on throw or try, which C++ here cannot use. */
  noExceptions:
    'C++ here is built without exceptions, so throw, try and catch cannot be used. Return an error value instead.',
} as const;
