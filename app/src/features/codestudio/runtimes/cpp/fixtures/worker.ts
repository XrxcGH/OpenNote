// The run worker of cpp.test.tsx: the real run protocol (serve.ts) and the C and C++ adapters. clang's files come
// from the test server, since only the app serves the pack scheme.
import clangUrl from '@yowasp/clang?url';
import { serve } from '../../../run/serve';
import { clangAdapter } from '../adapter';
import { Clang, type ClangModule } from '../clang';

const clang = new Clang(() => import(/* @vite-ignore */ new URL(clangUrl, location.href).href) as Promise<ClangModule>);

serve({ c: async () => clangAdapter('c', clang), cpp: async () => clangAdapter('cpp', clang) });
