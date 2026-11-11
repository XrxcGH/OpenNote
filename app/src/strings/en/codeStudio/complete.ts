// Completion: the suggestion list, snippets, and ghost text.
// Owner: code:L12 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioComplete = {
  /** The note beside each kind of item in the completion list. */
  detail: {
    keyword: 'keyword',
    builtin: 'built-in',
    member: 'member',
    module: 'module member',
    word: 'from open files',
    snippet: 'snippet',
  },
  /** What each snippet inserts, shown beside its label. */
  snippets: {
    forEach: 'for loop over items',
    forIndex: 'for loop with an index',
    whileLoop: 'while loop',
    functionDef: 'function',
    classDef: 'class',
    ifBlock: 'if block',
    mainBlock: 'main entry point',
    tryBlock: 'try block',
    printf: 'formatted print',
    select: 'SELECT query',
  },
} as const;
