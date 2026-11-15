// Diagnostics: syntax errors, checker messages, and the problems list.
// Owner: code:L10 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioDiagnostics = {
  /** One sentence per checker message id (diagnostics/types.ts MessageId). */
  messages: {
    syntax: 'Syntax error.',
    syntaxAt: "Syntax error: '{token}' is not expected here.",
    endOfFile: 'The file ends before the code is complete.',
    expectedColon: "Expected ':' at the end of the '{keyword}' line.",
    unclosed: "'{open}' opened on line {line} is never closed.",
    unexpectedClose: "'{close}' has no opening bracket.",
    mismatched: "'{close}' does not match '{open}' opened on line {line}.",
    unusedImport: "'{name}' is imported but never used.",
    redefined: "'{name}' is defined again, and the one on line {line} was never used.",
    undefinedName: "'{name}' is not defined.",
    unusedLocal: "'{name}' gets a value that is never used.",
    noneComparison: "Compare to None with 'is' or 'is not', not '{op}'.",
    boolComparison: "Comparing to {value} with '{op}' is not needed. Use the value itself.",
    isLiteral: "'{op}' compares identity, not value. Use '{better}' to compare with a literal.",
    tabIndent: 'This line is indented with tabs.',
    mixedIndent: 'This line mixes tabs and spaces in its indentation.',
    undefinedVar: "'{name}' is not defined.",
    unusedVar: "'{name}' is {kind, select, assigned {given a value} other {defined}} but never used.",
    constAssign: "'{name}' is a constant and cannot be given a new value.",
    unreachable: 'This code never runs.',
    eqeqeq: "Use '{better}' instead of '{op}'.",
    condAssign: "This condition assigns a value. Did you mean '=='?",
    fallthrough: "The case before this one falls through to it. Add 'break' or a '// falls through' comment.",
    undeclared: "Use of undeclared identifier '{name}'.",
    unusedVariable: "'{name}' is declared but never used.",
    luaUndefined: "'{name}' is not defined. Lua treats it as a global that is nil.",
    luaUnused: "Local '{name}' is never used.",
  },
} as const;
