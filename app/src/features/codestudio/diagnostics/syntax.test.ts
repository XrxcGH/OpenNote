import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { GRAMMAR_LANGUAGES, loadParser } from './parsers';
import { loadWorkerParser } from './workerParsers';
import { toDiagnostic } from './providers';
import { lineAt, lineStarts } from './text';
import type { EditorLanguage } from './types';

async function syntax(language: EditorLanguage, text: string) {
  const { syntax: found } = await analyze({ language, text, layers: ['syntax'] });
  const starts = lineStarts(text);
  return found.map((f) => ({ line: lineAt(starts, f.from), text: toDiagnostic('f', 'lezer', f).message }));
}

describe('Lezer syntax errors', () => {
  it('has a grammar for every tier-1 language with a Lezer pack', async () => {
    expect([...GRAMMAR_LANGUAGES].sort()).toEqual([
      'c',
      'cpp',
      'go',
      'java',
      'javascript',
      'python',
      'rust',
      'sql',
      'typescript',
    ]);
    for (const language of GRAMMAR_LANGUAGES) {
      expect(typeof (await loadParser(language))?.parse).toBe('function');
      expect(typeof (await loadWorkerParser(language))?.parse).toBe('function');
    }
    expect(loadParser('lua')).toBeNull();
    expect(loadWorkerParser('lua')).toBeNull();
  }, 60_000);

  it("says a Python block header lacks its ':'", async () => {
    expect(await syntax('python', 'x = 1\nif x > 0\n    print(x)\n')).toEqual([
      { line: 2, text: "Expected ':' at the end of the 'if' line." },
    ]);
    expect(await syntax('python', 'def area(r)\n    return r\n')).toEqual([
      { line: 1, text: "Expected ':' at the end of the 'def' line." },
    ]);
  });

  it("marks the real error line, not a one-line compound statement that has its ':'", async () => {
    const lines = async (text: string) => (await syntax('python', text)).map((f) => f.line);
    const colonFree = async (text: string) =>
      (await syntax('python', text)).every((f) => !f.text.startsWith("Expected ':'"));
    const cases: [string, number][] = [
      ['def fib(n):\n    if n < 2: return n\n    return fib(n - 1) +\n', 3],
      ['for i in range(3): print(i)\ny = 5 +\n', 2],
      ['while True: break\nprint("a" "b" 3)\n', 2],
      ['class E(Exception): pass\ntry: x = 1\nexcept E: pass\nz = 1 2\n', 4],
      ['match(m)\nx = = 1\n', 2],
    ];
    for (const [text, line] of cases) {
      expect(await lines(text), text).toEqual([line]);
      expect(await colonFree(text), text).toBe(true);
    }
  });

  it("says a match or case header lacks its ':' only inside a match statement", async () => {
    expect(await syntax('python', 'match x\n    case 1:\n        pass\n')).toEqual([
      { line: 1, text: "Expected ':' at the end of the 'match' line." },
    ]);
    expect(await syntax('python', 'match x:\n    case 1\n        pass\n')).toEqual([
      { line: 2, text: "Expected ':' at the end of the 'case' line." },
    ]);
  });
});

describe('Lezer syntax errors: brackets and tokens', () => {
  it('names the line where an unclosed bracket opened', async () => {
    expect(await syntax('python', 'total = sum([1, 2, 3)\nprint(total)\n')).toEqual([
      { line: 1, text: "')' does not match '[' opened on line 1." },
    ]);
    expect(await syntax('javascript', 'function f() {\n  if (x) {\n    return 1;\n}\n')).toEqual([
      { line: 1, text: "'{' opened on line 1 is never closed." },
    ]);
    expect(await syntax('c', 'int main(void) {\n  return 0;\n}\n}\n')).toEqual([
      { line: 4, text: "'}' has no opening bracket." },
    ]);
  });

  it('ignores brackets inside strings and comments', async () => {
    expect(await syntax('python', 'print("(")  # )\n')).toEqual([]);
    expect(await syntax('javascript', 'const s = "{"; // }\n/* ( */\n')).toEqual([]);
  });

  it('ignores brackets inside a regex, rune, char, text block, macro body, or quoted name', async () => {
    const valid: [EditorLanguage, string][] = [
      ['javascript', 'const open = /\\(/;\nconst t = s.replace(/[()]/g, "");\nconst c = /[)\\]}]/.test(ch);\n'],
      ['typescript', 'const open: RegExp = /\\{/;\n'],
      ['go', "package main\nfunc f(c rune) bool {\n\treturn c == '(' || c == ']'\n}\n"],
      ['c', "#define OPEN '{'\n#define CLOSE ')'\nint main(void) { return 0; }\n"],
      ['cpp', "#define OPEN '['\nint main() { char c = '('; return c; }\n"],
      ['java', 'class A {\n  String s = """\n    a ( b [\n    """;\n  char c = \'{\';\n}\n'],
      ['rust', "fn main() { let c = '('; }\n"],
      ['sql', 'SELECT "col(" FROM t;\n'],
    ];
    for (const [language, text] of valid) expect(await syntax(language, text), language).toEqual([]);
  }, 60_000);

  it('keeps checker marks below a line with a regex that holds a bracket', async () => {
    const text = 'const open = /\\(/;\nconsole.log(open, missing_name);\n';
    const { checker } = await analyze({ language: 'javascript', text, layers: ['checker'] });
    expect(checker.map((f) => f.code)).toEqual(['no-undef']);
  });

  it('names the unexpected token, or the early end of the file', async () => {
    expect(await syntax('javascript', 'let x = 1 +;\n')).toEqual([
      { line: 1, text: "Syntax error: ';' is not expected here." },
    ]);
    expect(await syntax('sql', 'SELECT * FROM t WHERE;\n')).toHaveLength(0);
    const end = await syntax('python', 'x = (1 +\n');
    expect(end.map((e) => e.text)).toEqual(["'(' opened on line 1 is never closed."]);
  });

  it('finds nothing in valid code of each grammar', async () => {
    const valid: [EditorLanguage, string][] = [
      ['python', 'def f(x):\n    return [i for i in range(x)]\n'],
      ['javascript', 'const f = (x) => ({ a: [x] });\n'],
      ['typescript', 'function f<T>(x: T): T[] { return [x]; }\n'],
      ['c', '#include <stdio.h>\nint main(void) { printf("%d\\n", 1); return 0; }\n'],
      ['cpp', '#include <vector>\nint main() { std::vector<int> v{1, 2}; return v.size(); }\n'],
      ['java', 'class A { int f() { return 1; } }\n'],
      ['rust', 'fn main() { let v = vec![1, 2]; println!("{}", v.len()); }\n'],
      ['go', 'package main\nfunc main() { x := []int{1}; _ = x }\n'],
      ['sql', 'SELECT name FROM people WHERE age > 3;\n'],
    ];
    for (const [language, text] of valid) expect(await syntax(language, text), language).toEqual([]);
  }, 60_000);

  it('keeps checker marks only above the first broken line', async () => {
    const text = 'import os\nx = 1\nif x\n    y = undefined_name\n';
    const { checker } = await analyze({ language: 'python', text, layers: ['checker'] });
    expect(checker.map((f) => f.code)).toEqual(['F401']);
  });
});
