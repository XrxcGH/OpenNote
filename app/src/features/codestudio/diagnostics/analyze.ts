// One analysis of one file: the syntax layer (L-a) and the checker layer (L-b) over a single parse. The diagnostics
// worker runs this; when a page has no workers (tests, or a worker that failed), the page runs it itself.

import { checkCLike } from './clike';
import { checkJavaScript } from './javascript';
import { checkLua } from './lua';
import { loadParser } from './parsers';
import { checkPython } from './python';
import { syntaxFindings } from './syntax';
import { lineAt, lineStarts } from './text';
import type { EditorLanguage, Finding } from './types';

/** The languages that have an OpenNote checker (DESIGN 6.1, layer L-b). */
export const CHECKER_LANGUAGES: readonly EditorLanguage[] = ['python', 'javascript', 'typescript', 'c', 'cpp', 'lua'];

export interface AnalyzeRequest {
  language: EditorLanguage;
  text: string;
  layers: readonly ('syntax' | 'checker')[];
}

export interface AnalyzeResult {
  syntax: Finding[];
  checker: Finding[];
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeResult> {
  const { language, text, layers } = request;
  if (language === 'lua') return { syntax: [], checker: layers.includes('checker') ? checkLua(text) : [] };
  const loading = loadParser(language);
  if (!loading) return { syntax: [], checker: [] };
  const tree = (await loading).parse(text);
  const syntax = syntaxFindings(text, tree, language);
  if (!layers.includes('checker') || !CHECKER_LANGUAGES.includes(language)) {
    return { syntax: layers.includes('syntax') ? syntax : [], checker: [] };
  }
  let checker =
    language === 'python'
      ? checkPython(text, tree)
      : language === 'c' || language === 'cpp'
        ? checkCLike(text, tree)
        : checkJavaScript(text, tree);
  if (syntax.length) {
    // Past a syntax error the tree is a guess, so checker marks after the first broken line would mislead.
    const starts = lineStarts(text);
    const firstBroken = Math.min(...syntax.map((f) => lineAt(starts, f.from)));
    checker = checker.filter((f) => lineAt(starts, f.from) < firstBroken);
  }
  return { syntax: layers.includes('syntax') ? syntax : [], checker };
}
