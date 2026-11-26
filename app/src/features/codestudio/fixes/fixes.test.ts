// Quick fixes (DESIGN 7.1, lane code:L11). Known answers come from CPython 3.12's own suggestion messages and the
// messages the languages' tools print. Every fix is checked by running the checker again on the edited file.

import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../contracts';
import { analyze } from '../diagnostics/analyze';
import { toDiagnostic } from '../diagnostics/providers';
import type { EditorLanguage } from '../diagnostics/types';
import {
  applyEdits,
  attachFixes,
  fixAll,
  fixesFor,
  fixKindsIn,
  fixMenu,
  MAX_FIX_DIAGNOSTICS,
  MAX_FIX_TEXT,
  sqlSchema,
  suggestions,
} from './index';
import { distance, limit } from './distance';

async function diagnose(language: EditorLanguage, text: string): Promise<Diagnostic[]> {
  const { syntax, checker } = await analyze({ language, text, layers: ['syntax', 'checker'] });
  return [...syntax.map((f) => toDiagnostic('f', 'lezer', f)), ...checker.map((f) => toDiagnostic('f', 'opennote', f))];
}

/** A diagnostic as a runtime prints it: a message at a line. */
function runtime(text: string, line: number, message: string, token = ''): Diagnostic {
  const lines = text.split('\n');
  const from = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  const at = token ? from + lines[line - 1]!.indexOf(token) : from;
  return {
    file: 'f',
    from: at,
    to: token ? at + token.length : from + lines[line - 1]!.length,
    severity: 'error',
    code: '',
    message,
    source: 'runtime',
  };
}

function applyFirst(text: string, language: EditorLanguage, d: Diagnostic, index = 0): string {
  const fix = fixesFor(d, { language, text })[index];
  if (!fix) throw new Error(`no fix for ${d.message}`);
  return applyEdits(text, fix.edits);
}

describe('did you mean (CPython 3.12 rule)', () => {
  it('offers print for pritn, as CPython says "Did you mean: \'print\'?"', () => {
    expect(suggestions('pritn', ['print', 'input', 'int'])[0]).toBe('print');
    expect(
      suggestions(
        'pritn',
        [...'abcdefgh'].map((c) => c + c + c),
      ),
    ).toEqual([]);
  });

  it('offers length for lenght (an attribute)', () => {
    expect(suggestions('lenght', ['length', 'width', 'height'])[0]).toBe('length');
  });

  it('offers nothing when the distance is too large', () => {
    expect(suggestions('xyz', ['print', 'length', 'abs'])).toEqual([]);
    expect(suggestions('a', ['print'])).toEqual([]);
  });

  it('uses the CPython limit and costs', () => {
    // (len(a) + len(b) + 3) * 2 / 6, rounded down.
    expect(limit('pritn', 'print')).toBe(4);
    expect(limit('abc', 'abcd')).toBe(3);
    // A change of letter costs 2, a change of case costs 1, a move costs 2.
    expect(distance('cat', 'cut')).toBe(2);
    expect(distance('Cat', 'cat')).toBe(1);
    expect(distance('cat', 'cats')).toBe(2);
    expect(distance('same', 'same')).toBe(0);
  });

  it('fixes an undefined Python name from the checker', async () => {
    const text = "pritn('hi')\n";
    const found = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    expect(found).toHaveLength(1);
    const fixed = applyFirst(text, 'python', found[0]!);
    expect(fixed).toBe("print('hi')\n");
    expect((await diagnose('python', fixed)).filter((d) => d.code === 'F821')).toEqual([]);
  });

  it('prefers a name the file declares', async () => {
    const text = 'total_count = 3\nprint(totl_count)\n';
    const found = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    const fixes = fixesFor(found[0]!, { language: 'python', text });
    expect(fixes[0]).toMatchObject({ title: 'Change to `total_count`', preferred: true });
  });

  it('fixes an undefined JavaScript name', async () => {
    const text = 'const items = [1];\nconsole.log(itmes);\n';
    const found = (await diagnose('javascript', text)).filter((d) => d.code === 'no-undef');
    expect(found).toHaveLength(1);
    const fixed = applyFirst(text, 'javascript', found[0]!);
    expect(fixed).toContain('console.log(items)');
    expect((await diagnose('javascript', fixed)).filter((d) => d.code === 'no-undef')).toEqual([]);
  });

  it('fixes a misspelled attribute from the runtime message', () => {
    const text = 'class Box:\n    def __init__(self):\n        self.length = 1\nb = Box()\nprint(b.lenght)\n';
    const d = runtime(text, 5, "AttributeError: 'Box' object has no attribute 'lenght'");
    expect(applyFirst(text, 'python', d)).toContain('print(b.length)');
    const list = runtime('xs = []\nxs.apend(1)\n', 2, "AttributeError: 'list' object has no attribute 'apend'");
    expect(applyFirst('xs = []\nxs.apend(1)\n', 'python', list)).toBe('xs = []\nxs.append(1)\n');
  });

  it('fixes a misspelled SQL column from the schema', () => {
    const text = 'CREATE TABLE users (id INTEGER, name TEXT);\nSELECT nmae FROM users;\n';
    const d = runtime(text, 2, 'no such column: nmae');
    expect(applyFirst(text, 'sql', d)).toBe('CREATE TABLE users (id INTEGER, name TEXT);\nSELECT name FROM users;\n');
    const table = runtime('CREATE TABLE users (id INTEGER);\nSELECT * FROM usres;\n', 2, 'no such table: usres');
    expect(applyFirst('CREATE TABLE users (id INTEGER);\nSELECT * FROM usres;\n', 'sql', table)).toContain(
      'FROM users;',
    );
  });

  it('fixes an undefined Lua name', async () => {
    const text = 'local total = 1\nprint(totl)\n';
    const found = (await diagnose('lua', text)).filter((d) => d.code === 'W113');
    expect(found).toHaveLength(1);
    expect(applyFirst(text, 'lua', found[0]!)).toContain('print(total)');
  });
});

describe('add a missing import or include', () => {
  it('adds the import CPython names: "Did you forget to import \'math\'?"', async () => {
    const text = 'print(math.sqrt(4))\n';
    const found = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    const fixes = fixesFor(found[0]!, { language: 'python', text });
    expect(fixes[0]).toMatchObject({ kind: 'addImport', title: 'Add `import math`' });
    const fixed = applyEdits(text, fixes[0]!.edits);
    expect(fixed).toBe('import math\nprint(math.sqrt(4))\n');
    expect((await diagnose('python', fixed)).filter((d) => d.code === 'F821')).toEqual([]);
  });

  it('knows the usual aliases and keeps them with the other imports', async () => {
    const text = '"""Plot."""\nimport os\n\nx = np.array([1])\nplt.show()\n';
    const found = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    expect(found).toHaveLength(2);
    const fixed = applyFirst(text, 'python', found[0]!);
    expect(fixed).toBe('"""Plot."""\nimport os\nimport numpy as np\n\nx = np.array([1])\nplt.show()\n');
    expect(applyFirst('plt.show()', 'python', (await diagnose('python', 'plt.show()'))[0]!)).toBe(
      'import matplotlib.pyplot as plt\nplt.show()',
    );
  });

  it('adds #include <stdio.h> for printf in C', async () => {
    const text = 'int main(void) {\n  printf("hi");\n  return 0;\n}\n';
    // The checker does not report calls (clang does, in the compiler layer), so the diagnostic is clang's own text.
    const d = runtime(
      text,
      2,
      "call to undeclared library function 'printf'; use of undeclared identifier 'printf'",
      'printf',
    );
    const fixed = applyFirst(text, 'c', d);
    expect(fixed).toBe(`#include <stdio.h>\n\n${text}`);
    expect((await diagnose('c', fixed)).filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('adds the C++ header for std names and puts it after the other includes', () => {
    const text = '#include <iostream>\nint main() {\n  std::vector<int> v;\n}\n';
    const d = runtime(text, 3, "no member named 'vector' in namespace 'std'", 'vector');
    expect(applyFirst(text, 'cpp', d)).toBe(
      '#include <iostream>\n#include <vector>\nint main() {\n  std::vector<int> v;\n}\n',
    );
    const cout = runtime('int main() { cout << 1; }\n', 1, "use of undeclared identifier 'cout'", 'cout');
    expect(applyFirst('int main() { cout << 1; }\n', 'cpp', cout)).toContain('#include <iostream>');
  });
});

describe('close a bracket or a quote', () => {
  it('closes a bracket at the end of its line', async () => {
    const text = 'print(1 + 2\nx = 3\n';
    const found = (await diagnose('python', text)).filter((d) => /never closed/.test(d.message));
    expect(found).toHaveLength(1);
    const fixed = applyFirst(text, 'python', found[0]!);
    expect(fixed).toBe('print(1 + 2)\nx = 3\n');
    expect((await diagnose('python', fixed)).filter((d) => /never closed/.test(d.message))).toEqual([]);
  });

  it('closes a bracket after the continuation lines under it', async () => {
    const text = 'items = [\n    1,\n    2,\nprint(items)\n';
    const found = (await diagnose('python', text)).filter((d) => /never closed/.test(d.message));
    expect(applyFirst(text, 'python', found[0]!)).toBe('items = [\n    1,\n    2,]\nprint(items)\n');
  });

  it('closes a brace on its own line in C', async () => {
    const text = 'int main(void) {\n  int a = 1;\n  return a;\n';
    const found = (await diagnose('c', text)).filter((d) => /never closed/.test(d.message));
    expect(found.length).toBeGreaterThan(0);
    const fixed = applyFirst(text, 'c', found[0]!);
    expect(fixed).toBe('int main(void) {\n  int a = 1;\n  return a;\n}\n');
  });

  it('closes a string before the bracket that ends the call', async () => {
    const text = 'print("hello)\n';
    const d = runtime(text, 1, 'SyntaxError: unterminated string literal (detected at line 1)');
    expect(applyFirst(text, 'python', d)).toBe('print("hello")\n');
    expect(applyFirst("x = 'ab\n", 'python', runtime("x = 'ab\n", 1, 'unterminated string literal'))).toBe(
      "x = 'ab'\n",
    );
  });
});

describe('indentation, colon, and semicolon', () => {
  it('adds the missing colon', async () => {
    const text = 'x = 1\nif x > 0\n    print(x)\n';
    const found = (await diagnose('python', text)).filter((d) => /Expected ':'/.test(d.message));
    expect(found).toHaveLength(1);
    const fixed = applyFirst(text, 'python', found[0]!);
    expect(fixed).toBe('x = 1\nif x > 0:\n    print(x)\n');
    expect((await diagnose('python', fixed)).filter((d) => /Expected ':'/.test(d.message))).toEqual([]);
  });

  it("answers CPython's \"expected ':'\" before a trailing comment", () => {
    const text = 'for i in range(3)  # loop\n    pass\n';
    const d = runtime(text, 1, "SyntaxError: expected ':'");
    expect(applyFirst(text, 'python', d)).toBe('for i in range(3):  # loop\n    pass\n');
  });

  it('indents the body after a header (IndentationError: expected an indented block)', () => {
    const text = 'if True:\nprint(1)\nprint(2)\n';
    const d = runtime(text, 2, "IndentationError: expected an indented block after 'if' statement on line 1");
    expect(applyFirst(text, 'python', d)).toBe('if True:\n    print(1)\nprint(2)\n');
    const empty = 'def f():\n';
    const e = runtime(empty, 2, 'IndentationError: expected an indented block after function definition on line 1');
    expect(applyFirst(empty, 'python', e)).toBe('def f():\n    pass\n');
  });

  it('removes an unexpected indent and aligns an unindent', () => {
    const text = 'x = 1\n    y = 2\n';
    expect(applyFirst(text, 'python', runtime(text, 2, 'IndentationError: unexpected indent'))).toBe('x = 1\ny = 2\n');
    const mismatch = 'if True:\n        a = 1\n    b = 2\n';
    const d = runtime(mismatch, 3, 'IndentationError: unindent does not match any outer indentation level');
    expect(applyFirst(mismatch, 'python', d)).toBe('if True:\n        a = 1\nb = 2\n');
  });

  it('turns tab indentation into spaces', async () => {
    const text = 'if True:\n\tx = 1\n';
    const found = (await diagnose('python', text)).filter((d) => d.code === 'W191');
    expect(found).toHaveLength(1);
    const fixed = applyFirst(text, 'python', found[0]!);
    expect(fixed).toBe('if True:\n    x = 1\n');
    expect((await diagnose('python', fixed)).filter((d) => d.code === 'W191' || d.code === 'E101')).toEqual([]);
  });

  it('adds a missing semicolon at the end of the previous token', async () => {
    const text = 'int main(void) {\n  int a = 1\n  return a;\n}\n';
    const found = (await diagnose('c', text)).filter((d) => d.severity === 'error');
    expect(found.length).toBeGreaterThan(0);
    const fixed = applyFirst(text, 'c', found[0]!);
    expect(fixed).toBe('int main(void) {\n  int a = 1;\n  return a;\n}\n');
    expect((await diagnose('c', fixed)).filter((d) => d.severity === 'error')).toEqual([]);
    const clang = runtime('int a = 1\nint b;\n', 2, "expected ';' at end of declaration", 'int b');
    expect(applyFirst('int a = 1\nint b;\n', 'c', clang)).toBe('int a = 1;\nint b;\n');
  });
});

describe('= to ==, and add self', () => {
  it('changes = to == in a JavaScript condition', async () => {
    const text = 'let a = 0;\nif (a = 1) {\n  a++;\n}\n';
    const found = (await diagnose('javascript', text)).filter((d) => d.code === 'no-cond-assign');
    expect(found).toHaveLength(1);
    const fixed = applyFirst(text, 'javascript', found[0]!);
    expect(fixed).toContain('if (a == 1)');
    expect((await diagnose('javascript', fixed)).filter((d) => d.code === 'no-cond-assign')).toEqual([]);
  });

  it("answers CPython's \"Maybe you meant '==' or ':='\" message", () => {
    const text = 'x = 2\nif x = 1:\n    pass\n';
    const d = runtime(text, 2, "SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?");
    expect(applyFirst(text, 'python', d)).toBe('x = 2\nif x == 1:\n    pass\n');
  });

  it('adds self to a method that uses it', async () => {
    const text = 'class A:\n    def show():\n        return self.x\n';
    const found = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    expect(found).toHaveLength(1);
    const fixes = fixesFor(found[0]!, { language: 'python', text });
    expect(fixes[0]).toMatchObject({ kind: 'addSelf' });
    const fixed = applyEdits(text, fixes[0]!.edits);
    expect(fixed).toBe('class A:\n    def show(self):\n        return self.x\n');
    expect((await diagnose('python', fixed)).filter((d) => d.code === 'F821')).toEqual([]);
    const more = 'class A:\n    def add(n):\n        return self.x + n\n';
    const m = (await diagnose('python', more)).filter((d) => d.code === 'F821');
    expect(applyFirst(more, 'python', m[0]!)).toContain('def add(self, n):');
  });

  it('does not add self outside a class', async () => {
    const text = 'def show():\n    return self.x\n';
    const found = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    expect(fixesFor(found[0]!, { language: 'python', text }).some((f) => f.kind === 'addSelf')).toBe(false);
  });
});

describe('the fix service', () => {
  it('attaches fixes to diagnostics and leaves the rest alone', async () => {
    const text = "pritn('a')\nx = 1\n";
    const items = await diagnose('python', text);
    const attached = attachFixes(items, { language: 'python', text });
    expect(attached.find((d) => d.code === 'F821')?.fixes?.[0]?.title).toBe('Change to `print`');
    expect(attached.length).toBe(items.length);
  });

  it('never offers an edit outside the file', () => {
    const d: Diagnostic = { ...runtime('x\n', 1, "'q' is not defined."), from: 500, to: 501 };
    expect(fixesFor(d, { language: 'python', text: 'x\n' })).toEqual([]);
  });

  it('fixes all of one kind in a file', async () => {
    const text = "pritn('a')\nprtin('b')\nprint('c')\n";
    const items = (await diagnose('python', text)).filter((d) => d.code === 'F821');
    const ctx = { language: 'python' as const, text };
    expect(fixKindsIn(items, ctx).get('didYouMean')).toBe(2);
    const all = fixAll(items, ctx, 'didYouMean');
    expect(all).not.toBeNull();
    const fixed = applyEdits(text, all!.edits);
    expect(fixed).toBe("print('a')\nprint('b')\nprint('c')\n");
    expect((await diagnose('python', fixed)).filter((d) => d.code === 'F821')).toEqual([]);
    expect(fixAll(items.slice(0, 1), ctx, 'didYouMean')).toBeNull();
  });
});

describe('gaps found in review (lane code:L11)', () => {
  const unfixed = (items: Diagnostic[], re: RegExp) => items.filter((d) => re.test(d.message));

  it('indents a tab-indented block with tabs, so the checker is satisfied', async () => {
    const text = 'def f():\n\tif x:\n\ty = 1\n';
    const d = runtime(text, 3, 'IndentationError: expected an indented block after if statement on line 2');
    const fixed = applyFirst(text, 'python', d);
    expect(fixed).toBe('def f():\n\tif x:\n\t\ty = 1\n');
    expect(fixed).not.toMatch(/\t {2,}/);
    expect(
      unfixed(await diagnose('python', fixed), /expected an indented|inconsistent|unindent|unexpected indent/i),
    ).toEqual([]);
  });

  it('keeps tabs under the lines it re-indents and unindents to the matching line', () => {
    const text = 'def f():\n\tif x:\n\ty = 1\n\t\tz = 2\n';
    const d = runtime(text, 3, 'IndentationError: expected an indented block after if statement on line 2');
    expect(applyFirst(text, 'python', d)).toBe('def f():\n\tif x:\n\t\ty = 1\n\t\t\tz = 2\n');
    const bad = 'if a:\n\tx = 1\n\t\ty = 2\n      z = 3\n';
    const u = runtime(bad, 4, 'IndentationError: unindent does not match any outer indentation level');
    expect(applyFirst(bad, 'python', u)).toBe('if a:\n\tx = 1\n\t\ty = 2\n\tz = 3\n');
  });

  it('closes the open string and the bracket in one edit', async () => {
    const text = 'print("a" + "b)\nx = 1\n';
    const items = await diagnose('python', text);
    const never = items.find((d) => /never closed/.test(d.message))!;
    const fixed = applyFirst(text, 'python', never);
    expect(fixed).toBe('print("a" + "b")\nx = 1\n');
    expect(unfixed(await diagnose('python', fixed), /never closed|unterminated/i)).toEqual([]);
  });

  it("reads the editor parser's indentation errors, not only the runtime text", () => {
    const text = 'x = 1\n    y = 2\n';
    const unexpected = { ...runtime(text, 2, 'Syntax error: y is not expected here', 'y'), source: 'lezer' as const };
    expect(applyFirst(text, 'python', unexpected)).toBe('x = 1\ny = 2\n');
    const block = 'def f():\ny = 1\n';
    const lezer = { ...runtime(block, 2, 'Syntax error: y is not expected here', 'y'), source: 'lezer' as const };
    expect(applyFirst(block, 'python', lezer)).toBe('def f():\n    y = 1\n');
  });

  it("keeps the file's CRLF line endings in every insert", () => {
    const text = 'def f():\r\nx = 1\r\n';
    const d = runtime(text, 2, 'IndentationError: expected an indented block after function definition on line 1');
    expect(applyFirst(text, 'python', d)).not.toMatch(/(?<!\r)\n/);
    const blank = 'def f():\r\n';
    const e = runtime(blank, 1, 'IndentationError: expected an indented block after function definition on line 1');
    expect(applyFirst(blank, 'python', { ...e, from: blank.length, to: blank.length })).not.toMatch(/(?<!\r)\n/);
    const imp = 'x = math.pi\r\n';
    const n = runtime(imp, 1, "NameError: name 'math' is not defined", 'math');
    expect(applyFirst(imp, 'python', n)).toBe('import math\r\nx = math.pi\r\n');
    const c = 'int main() {\r\n  return 0;\r\n';
    const open: Diagnostic = { ...runtime(c, 1, "'{' was never closed"), source: 'opennote' };
    expect(applyFirst(c, 'c', open)).not.toMatch(/(?<!\r)\n/);
  });

  it('adds the semicolon before a trailing comment', () => {
    const text = 'int a = 1 // note\nint b = 2;\n';
    const d = { ...runtime(text, 1, "expected ';' at end of declaration"), from: 17, to: 17 };
    expect(applyFirst(text, 'c', d)).toBe('int a = 1; // note\nint b = 2;\n');
  });
});

describe('fix performance caps', () => {
  it('stays fast with thousands of diagnostics in a large file', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `v${i} = prnt(${i})  # filler text for a long line ......`);
    const text = lines.join('\n') + '\n';
    expect(text.length).toBeGreaterThan(100_000);
    const items = lines.map((_, i) => runtime(text, i + 1, "NameError: name 'prnt' is not defined", 'prnt'));
    const ctx = { language: 'python' as const, text };
    const start = performance.now();
    const attached = attachFixes(items, ctx);
    const kinds = fixKindsIn(items, ctx);
    const all = fixAll(items, ctx, 'didYouMean');
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(3000);
    expect(attached.filter((d) => d.fixes?.length).length).toBe(MAX_FIX_DIAGNOSTICS);
    expect(kinds.get('didYouMean')).toBe(MAX_FIX_DIAGNOSTICS);
    expect(all?.edits.length).toBe(MAX_FIX_DIAGNOSTICS);
  });

  it('offers nothing in a text over the size cap', () => {
    const text = `${'#'.repeat(MAX_FIX_TEXT)}\npritn('a')\n`;
    const d = runtime(text, 2, "NameError: name 'pritn' is not defined", 'pritn');
    expect(attachFixes([d], { language: 'python', text })[0]!.fixes).toBeUndefined();
  });

  it('builds the Ctrl+. menu data: fixes on each diagnostic and one Fix all entry per kind', () => {
    const text = "pritn('a')\nprtin('b')\n";
    const items = [
      runtime(text, 1, "NameError: name 'pritn' is not defined", 'pritn'),
      runtime(text, 2, "NameError: name 'prtin' is not defined", 'prtin'),
    ];
    const menu = fixMenu(items, { language: 'python', text });
    expect(menu.items.every((d) => d.fixes?.length)).toBe(true);
    expect(menu.all.map((e) => [e.kind, e.count])).toEqual([['didYouMean', 2]]);
    expect(applyEdits(text, menu.all[0]!.fix.edits)).toBe("print('a')\nprint('b')\n");
  });
});

describe('review gaps, second round', () => {
  // A semicolon inside brackets is a new syntax error. The known answer is the language grammar: a call, an array, and
  // an object literal take commas.
  it.each([
    ['javascript', 'console.log(x y)\n', 'y'],
    ['javascript', 'foo(1 2)\n', '2'],
    ['javascript', 'const a = [1 2]\n', '2'],
    ['javascript', 'const o = {a: 1 b: 2}\n', 'b'],
  ] as const)('offers no semicolon inside brackets: %s %s', (language, text, token) => {
    const d = runtime(text, 1, `Syntax error: '${token}' is not expected here`, token);
    expect(fixesFor(d, { language, text }).filter((f) => f.kind === 'addSemicolon')).toEqual([]);
  });

  it('still adds the semicolon after a statement, also inside a block or after a closed call', () => {
    const text = 'function f() {\n  foo(1)\n  bar(2)\n}\n';
    const d = runtime(text, 3, "Syntax error: 'bar' is not expected here", 'bar');
    expect(applyFirst(text, 'javascript', d)).toBe('function f() {\n  foo(1);\n  bar(2)\n}\n');
  });

  it('offers one entry for two fixes that give the same text', () => {
    const text = 'print("hi)\n';
    const d = runtime(text, 1, "SyntaxError: '(' was never closed", '(');
    const results = fixesFor(d, { language: 'python', text }).map((f) => applyEdits(text, f.edits));
    expect(new Set(results).size).toBe(results.length);
  });

  it('reads an unclosed CREATE TABLE in bounded time and caches the schema per text', () => {
    const text = 'create table t (\n'.repeat(17_000) + 'select nme from t;\n';
    const d = runtime(text, 17_001, 'no such column: nme', 'nme');
    const ctx = { language: 'sql' as const, text };
    const start = performance.now();
    fixesFor(d, ctx);
    expect(performance.now() - start).toBeLessThan(3000);
    expect(sqlSchema(ctx)).toBe(sqlSchema(ctx));
  });

  it('ends a table list at a semicolon', () => {
    const text = 'create table a (x int;\ncreate table b (y int);\n';
    const schema = sqlSchema({ language: 'sql', text });
    expect(schema.get('b')).toEqual(['y']);
  });
});

describe('a misspelled console member (T4-D09-7)', () => {
  it('is marked, and Ctrl+. offers the right name', async () => {
    const text = 'console.lgo(1);\nconsole.log(2);\nconsole.dir({});\n';
    const found = (await diagnose('javascript', text)).filter((d) => d.code === 'no-unknown-member');
    expect(found).toHaveLength(1);
    expect(text.slice(found[0]!.from, found[0]!.to)).toBe('lgo');
    expect(applyFirst(text, 'javascript', found[0]!)).toBe('console.log(1);\nconsole.log(2);\nconsole.dir({});\n');
  });
});
