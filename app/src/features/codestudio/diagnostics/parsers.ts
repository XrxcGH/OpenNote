// The Lezer parser of each language that has a grammar, loaded on first use. On the page they come through the
// editor's language packs, so the chunks the editor already loaded serve both, and a syntax mark agrees with the
// highlighting. The worker loads the bare grammars instead (workerParsers.ts).

import type { Parser } from '@lezer/common';
import type { EditorLanguage } from './types';

export type ParserLoader = (language: EditorLanguage) => Promise<Parser> | null;

const LOADERS: Partial<Record<EditorLanguage, () => Promise<Parser>>> = {
  python: () => import('@codemirror/lang-python').then((m) => m.pythonLanguage.parser),
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascriptLanguage.parser),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.typescriptLanguage.parser),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cppLanguage.parser),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cppLanguage.parser),
  java: () => import('@codemirror/lang-java').then((m) => m.javaLanguage.parser),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rustLanguage.parser),
  go: () => import('@codemirror/lang-go').then((m) => m.goLanguage.parser),
  sql: () => import('@codemirror/lang-sql').then((m) => m.SQLite.language.parser),
};

/** The languages with a Lezer grammar. */
export const GRAMMAR_LANGUAGES = Object.keys(LOADERS) as EditorLanguage[];

/** A loader that keeps each parser once it has loaded. */
export function cachedLoader(loaders: Partial<Record<EditorLanguage, () => Promise<Parser>>>): ParserLoader {
  const cache = new Map<EditorLanguage, Promise<Parser>>();
  return (language) => {
    const load = loaders[language];
    if (!load) return null;
    let parser = cache.get(language);
    if (!parser) cache.set(language, (parser = load()));
    return parser;
  };
}

/** The language's parser, or null when it has no Lezer grammar (Lua and the legacy modes). */
export const loadParser: ParserLoader = cachedLoader(LOADERS);
