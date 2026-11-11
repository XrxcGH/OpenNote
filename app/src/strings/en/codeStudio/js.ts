// JavaScript and TypeScript: the runtime, modules, and the test API.
// Owner: code:L06 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioJs = {
  modules: {
    missingFile: "Cannot find module '{specifier}' imported from {from}. Check the path and the file name.",
    missingPackage:
      "Cannot find module '{specifier}' imported from {from}. Packages are not available here. Import with ./ or ../.",
    notScript: 'Cannot run {path}. Only .js and .ts files run here.',
  },
  tests: {
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
