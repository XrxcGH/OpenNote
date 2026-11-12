// The live check worker's entry (checker.ts): clang from the pack, for C and C++.
import { cAdapter, cppAdapter } from './index';
import { serveChecks } from './checkServe';

serveChecks({ c: () => Promise.resolve(cAdapter), cpp: () => Promise.resolve(cppAdapter) });
