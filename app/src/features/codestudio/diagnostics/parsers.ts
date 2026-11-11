// The Lezer parser of each language that has a grammar, loaded on first use. These are the same grammars the editor's
// language packs use, so a syntax mark and the highlighting agree. SQL's grammar comes with its CodeMirror package.

import type { Parser } from '@lezer/common';
import type { EditorLanguage } from './types';

const LOADERS: Partial<Record<EditorLanguage, () => Promise<Parser>>> = {
  python: () => import('@lezer/python').then((m) => m.parser),
  javascript: () => import('@lezer/javascript').then((m) => m.parser),
  typescript: () => import('@lezer/javascript').then((m) => m.parser.configure({ dialect: 'ts' })),
  c: () => import('@lezer/cpp').then((m) => m.parser),
  cpp: () => import('@lezer/cpp').then((m) => m.parser),
  java: () => import('@lezer/java').then((m) => m.parser),
  rust: () => import('@lezer/rust').then((m) => m.parser),
  go: () => import('@lezer/go').then((m) => m.parser),
  sql: () => import('@codemirror/lang-sql').then((m) => m.SQLite.language.parser),
};

/** The languages with a Lezer grammar. */
export const GRAMMAR_LANGUAGES = Object.keys(LOADERS) as EditorLanguage[];

const cache = new Map<EditorLanguage, Promise<Parser>>();

/** The language's parser, or null when it has no Lezer grammar (Lua and the legacy modes). */
export function loadParser(language: EditorLanguage): Promise<Parser> | null {
  const load = LOADERS[language];
  if (!load) return null;
  let parser = cache.get(language);
  if (!parser) cache.set(language, (parser = load()));
  return parser;
}
