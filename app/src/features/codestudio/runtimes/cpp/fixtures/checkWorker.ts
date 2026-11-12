// The live check worker of cpp.test.tsx: the real check side (checkServe.ts) with clang from the test server.
import clangUrl from '@yowasp/clang?url';
import { clangAdapter } from '../adapter';
import { serveChecks } from '../checkServe';
import { Clang, type ClangModule } from '../clang';

const clang = new Clang(() => import(/* @vite-ignore */ new URL(clangUrl, location.href).href) as Promise<ClangModule>);

serveChecks({ c: async () => clangAdapter('c', clang), cpp: async () => clangAdapter('cpp', clang) });
