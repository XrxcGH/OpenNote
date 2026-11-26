// JavaScript and TypeScript: the runtime, modules, and the test API.
// Owner: code:L06 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioJs = {
  modules: {
    missingFile: "Cannot find module '{specifier}' imported from {from}. Check the path and the file name.",
    missingPackage:
      "Cannot find module '{specifier}' imported from {from}. Packages are not available here. Import with ./ or ../.",
    notScript: 'Cannot run {path}. Only .js and .ts files run here.',
    missingMain: 'Cannot run {path}. The project has no file with that name.',
  },
  typescript: {
    namespace: 'A namespace or module block with code in it cannot run here. Use a plain object or a separate file.',
    declarators: 'Export one name in each statement here: "export const a = 1;" and then "export const b = 2;".',
  },
  tests: {
    tooMany: 'This run has {count} tests. Only the first {max} ran. Split the tests into several runs.',
    time: 'The test was still running when the run reached its time limit.',
    memory: 'The test ran out of memory, so the run stopped.',
    notRunLimit: 'The test did not run, because the run stopped at a limit.',
    nested: 'A test cannot start inside another test. Move test() and describe() out of the test body.',
    notSupported: '{name} is not supported here. Write each test with test() or it().',
    summary: 'Tests: {passed} passed, {failed} failed, {skipped} skipped, {total} total.',
    none: 'No tests found. Write them with test() or it() in a file ending in .test.js or .test.ts.',
    stuck: 'The test did not finish. It waits for a promise that never settles.',
    notRun: 'The test did not run, because an earlier test did not finish.',
    loadFailed: 'This test file stopped with an error before its tests ran.',
    pass: 'PASS {name}',
    fail: 'FAIL {name}',
    skip: 'SKIP {name}',
  },
} as const;
