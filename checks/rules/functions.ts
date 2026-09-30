// Finds functions in source code without a full parser. Brace languages are matched by braces;
// Python is matched by indentation. Results are approximate but consistent, which is what limits need.

import type { SourceFile } from '../types.ts';

export interface FunctionSpan {
  name: string;
  start: number;
  end: number;
  maxDepth: number;
  parameters: number;
}

const CONTROL =
  /^\s*(}\s*)?(if|else|for|while|switch|catch|match|loop|unsafe|with|using|lock|do|try|finally|return|new)\b/;
const SIGNATURE_END = /(\)|=>)\s*(->\s*[^{]+|:\s*[^{=]+)?\s*$/;

export function findFunctions(file: SourceFile): FunctionSpan[] {
  const code = file.codeOnly();
  return file.ext === 'py' ? pythonFunctions(code) : braceFunctions(code);
}

function braceFunctions(code: string[]): FunctionSpan[] {
  const spans: FunctionSpan[] = [];
  code.forEach((lineText, lineIndex) => {
    for (let col = lineText.indexOf('{'); col !== -1; col = lineText.indexOf('{', col + 1)) {
      const signature = signatureBefore(code, lineIndex, col);
      if (!signature || CONTROL.test(signature) || !SIGNATURE_END.test(signature)) continue;
      const body = measureBody(code, lineIndex, col);
      if (!body) continue;
      spans.push({
        name: functionName(signature),
        start: lineIndex + 1,
        end: body.end + 1,
        maxDepth: body.maxDepth,
        parameters: countParameters(signature),
      });
    }
  });
  return spans;
}

/** Text before an opening brace, reaching back up to 6 lines for multi-line signatures. */
function signatureBefore(code: string[], lineIndex: number, col: number): string | undefined {
  const parts = [code[lineIndex].slice(0, col)];
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 6); i--) {
    const joined = parts.join(' ');
    if (joined.includes('(') && balance(joined) >= 0) break;
    if (/[;{}]\s*$/.test(code[i])) break;
    parts.unshift(code[i]);
  }
  const signature = parts.join(' ').trim();
  const statementStart = Math.max(signature.lastIndexOf(';'), signature.lastIndexOf('}'));
  const statement = signature.slice(statementStart + 1).trim();
  return statement === '' ? undefined : statement;
}

function balance(text: string): number {
  return (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
}

function measureBody(code: string[], lineIndex: number, col: number): { end: number; maxDepth: number } | undefined {
  let depth = 0;
  let maxDepth = 0;
  for (let i = lineIndex; i < code.length; i++) {
    const text = i === lineIndex ? code[i].slice(col) : code[i];
    for (const char of text) {
      if (char === '{') maxDepth = Math.max(maxDepth, ++depth);
      if (char === '}' && --depth === 0) return { end: i, maxDepth: maxDepth - 1 };
    }
  }
  return undefined;
}

function functionName(signature: string): string {
  const named = /(?:function\s*\*?\s*|fn\s+|def\s+)([A-Za-z_$][\w$]*)/.exec(signature);
  if (named) return named[1];
  const assigned = /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\()/.exec(signature);
  if (assigned) return assigned[1];
  const method = /([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(signature);
  return method ? method[1] : 'anonymous';
}

export function countParameters(signature: string): number {
  const open = signature.indexOf('(');
  if (open === -1) return 0;
  let depth = 0;
  let commas = 0;
  let contentSinceComma = false;
  for (const char of signature.slice(open + 1)) {
    if ('([{<'.includes(char)) depth++;
    if (')]}>'.includes(char) && depth-- === 0) break;
    if (char === ',' && depth === 0) {
      commas++;
      contentSinceComma = false;
    } else if (!/\s/.test(char)) {
      contentSinceComma = true;
    }
  }
  // A trailing comma doesn't add a parameter.
  const params = commas + (contentSinceComma ? 1 : 0);
  return /\(\s*&?(mut\s+)?self\b/.test(signature) ? params - 1 : params;
}

function pythonFunctions(code: string[]): FunctionSpan[] {
  const spans: FunctionSpan[] = [];
  code.forEach((text, i) => {
    const match = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(text);
    if (!match) return;
    const indent = match[1].length;
    let end = i;
    let maxIndent = indent;
    for (let j = i + 1; j < code.length; j++) {
      if (code[j].trim() === '') continue;
      const lineIndent = code[j].length - code[j].trimStart().length;
      if (lineIndent <= indent) break;
      end = j;
      maxIndent = Math.max(maxIndent, lineIndent);
    }
    const maxDepth = Math.round((maxIndent - indent) / 4);
    spans.push({
      name: match[2],
      start: i + 1,
      end: end + 1,
      maxDepth,
      parameters: countParameters(text.replace(/\(\s*self\s*,?/, '(')),
    });
  });
  return spans;
}
