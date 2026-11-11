// The diagnostics worker's parsers: the bare Lezer grammars, without the editor's CodeMirror packages, which a worker
// has no use for. They are the same grammars the language packs wrap. SQL's grammar only ships inside its package.

import { cachedLoader, type ParserLoader } from './parsers';

export const loadWorkerParser: ParserLoader = cachedLoader({
  python: () => import('@lezer/python').then((m) => m.parser),
  javascript: () => import('@lezer/javascript').then((m) => m.parser),
  typescript: () => import('@lezer/javascript').then((m) => m.parser.configure({ dialect: 'ts' })),
  c: () => import('@lezer/cpp').then((m) => m.parser),
  cpp: () => import('@lezer/cpp').then((m) => m.parser),
  java: () => import('@lezer/java').then((m) => m.parser),
  rust: () => import('@lezer/rust').then((m) => m.parser),
  go: () => import('@lezer/go').then((m) => m.parser),
  sql: () => import('@codemirror/lang-sql').then((m) => m.SQLite.language.parser),
});
