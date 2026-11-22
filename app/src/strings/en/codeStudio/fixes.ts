// Quick fixes: the fixes a diagnostic offers.
// Owner: code:L11 (B12). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioFixes = {
  /** The menu entry of each fix (Ctrl+. and the lightbulb). */
  titles: {
    change: 'Change to `{name}`',
    addImport: 'Add `{line}`',
    close: 'Add `{char}` to close it',
    closeQuote: 'Add `{char}` to close the string',
    indent: 'Fix the indentation',
    addColon: "Add ':' at the end of the line",
    addSemicolon: "Add ';' at the end of the statement",
    compare: 'Change `=` to `==`',
    addSelf: 'Add `self` as the first parameter',
    include: 'Add `{line}`',
  },
} as const;
