// Snippets with fields (DESIGN 10.2). Templates use CodeMirror's `${1:name}` fields; a tab character in a template
// becomes one indent unit of the editor. Enter and Shift+Enter move between fields; Tab indents (DESIGN 5.3).

import type { codeStudioComplete } from '../../../strings/en/codeStudio/complete';

export type SnippetNote = keyof typeof codeStudioComplete.snippets;

export interface Snippet {
  label: string;
  note: SnippetNote;
  template: string;
}

const s = (label: string, note: SnippetNote, template: string): Snippet => ({ label, note, template });

const C_LOOPS: readonly Snippet[] = [
  s('fori', 'forIndex', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}'),
  s('while', 'whileLoop', 'while (${1:condition}) {\n\t${2}\n}'),
  s('if', 'ifBlock', 'if (${1:condition}) {\n\t${2}\n}'),
];

const JS: readonly Snippet[] = [
  s('for', 'forEach', 'for (const ${1:item} of ${2:items}) {\n\t${3}\n}'),
  s('fori', 'forIndex', 'for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}'),
  s('while', 'whileLoop', 'while (${1:condition}) {\n\t${2}\n}'),
  s('function', 'functionDef', 'function ${1:name}(${2:params}) {\n\t${3}\n}'),
  s('class', 'classDef', 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t${3}\n\t}\n}'),
  s('if', 'ifBlock', 'if (${1:condition}) {\n\t${2}\n}'),
  s('try', 'tryBlock', 'try {\n\t${1}\n} catch (${2:error}) {\n\t${3}\n}'),
];

/** Snippets per language. */
export const SNIPPETS: Readonly<Record<string, readonly Snippet[]>> = {
  python: [
    s('for', 'forEach', 'for ${1:item} in ${2:items}:\n\t${3:pass}'),
    s('fori', 'forIndex', 'for ${1:i} in range(${2:n}):\n\t${3:pass}'),
    s('while', 'whileLoop', 'while ${1:condition}:\n\t${2:pass}'),
    s('def', 'functionDef', 'def ${1:name}(${2:params}):\n\t${3:pass}'),
    s('class', 'classDef', 'class ${1:Name}:\n\tdef __init__(self${2}):\n\t\t${3:pass}'),
    s('if', 'ifBlock', 'if ${1:condition}:\n\t${2:pass}'),
    s('main', 'mainBlock', 'if __name__ == "__main__":\n\t${1:main()}'),
    s('try', 'tryBlock', 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:error}:\n\t${4:raise}'),
  ],
  javascript: JS,
  typescript: JS,
  c: [
    ...C_LOOPS,
    s('main', 'mainBlock', 'int main(void) {\n\t${1}\n\treturn 0;\n}'),
    s('printf', 'printf', 'printf("${1:%d}\\n", ${2:value});'),
  ],
  cpp: [
    s('for', 'forEach', 'for (const auto& ${1:item} : ${2:items}) {\n\t${3}\n}'),
    ...C_LOOPS,
    s('main', 'mainBlock', 'int main() {\n\t${1}\n\treturn 0;\n}'),
    s('class', 'classDef', 'class ${1:Name} {\npublic:\n\t${2}\n};'),
    s('try', 'tryBlock', 'try {\n\t${1}\n} catch (const std::exception& ${2:error}) {\n\t${3}\n}'),
    s('printf', 'printf', 'printf("${1:%d}\\n", ${2:value});'),
  ],
  java: [
    s('for', 'forEach', 'for (${1:int} ${2:item} : ${3:items}) {\n\t${4}\n}'),
    ...C_LOOPS,
    s('main', 'mainBlock', 'public static void main(String[] args) {\n\t${1}\n}'),
    s('class', 'classDef', 'public class ${1:Name} {\n\t${2}\n}'),
    s('try', 'tryBlock', 'try {\n\t${1}\n} catch (${2:Exception} ${3:error}) {\n\t${4}\n}'),
  ],
  sql: [s('select', 'select', 'SELECT ${1:*} FROM ${2:table} WHERE ${3:condition};')],
};
