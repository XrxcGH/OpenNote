// Explanations for the catalog entries of code:L11 (clang diagnostics, first half): what happened, the likely cause, and what to try.

export const explainClang = {
  clUndeclared: {
    what: 'The name {name} has not been declared.',
    cause:
      'The compiler met {name} before any declaration. A typo, a missing include, or a variable ' +
      'declared in another block is the usual cause.',
    next: 'Check the spelling. Add the header for a library function. Declare the variable before ' + 'this line.',
  },
  clExpectedSemicolonExpr: {
    what: 'A semicolon is missing after the {what}.',
    cause: 'Statements in C and C++ end with a semicolon.',
    next: 'Add a semicolon at the end of the statement, at the point the compiler marks.',
  },
  clExpectedSemicolonDecl: {
    what: 'A semicolon is missing after a declaration.',
    cause: 'Every declaration ends with a semicolon.',
    next: 'Add a semicolon after the declaration.',
  },
  clExpectedSemicolonStruct: {
    what: 'A semicolon is missing after the closing brace of a struct or class.',
    cause: 'A struct, class, union, or enum definition ends with a semicolon after its closing brace.',
    next: 'Add a semicolon after the closing brace.',
  },
  clExpectedParen: {
    what: 'A closing parenthesis is missing.',
    cause: 'An opening parenthesis has no partner. Look at function calls and if conditions first.',
    next: 'Count the parentheses on the line and the line above.',
  },
  clExpectedBrace: {
    what: 'A closing brace is missing.',
    cause: 'A block opened with a brace was never closed.',
    next: 'Match every opening brace with a closing brace. Indent each block to see which is open.',
  },
  clExpectedExpression: {
    what: 'A value or calculation is missing here.',
    cause:
      'The compiler expected a value and found something else, such as a stray symbol, a missing ' +
      'operand, or an extra comma.',
    next: 'Look at the marked spot and the characters just before it.',
  },
  clExpectedIdentifier: {
    what: 'A name is missing here.',
    cause:
      'The compiler expected a name or a parenthesis, often after a stray comma or at the start ' +
      'of a bad declaration.',
    next: 'Check the declaration for a missing name or an extra symbol.',
  },
  clExpectedUnqualified: {
    what: 'A declaration or name is missing here.',
    cause: 'Code that is not a declaration appears outside any function, or a symbol is left over.',
    next: 'Move statements inside a function. Check for a stray semicolon or brace.',
  },
  clExpectedType: {
    what: 'A type is missing.',
    cause: 'The compiler expected a type name, such as int, and found something else.',
    next: 'Add the type before the name.',
  },
  clUnknownType: {
    what: 'The type {name} is not known.',
    cause:
      'The compiler does not know this type. It may be misspelled, or it needs a header, or a ' +
      'using line, such as std::string.',
    next: 'Check the spelling. Add the include, and in C++ write std:: before the name.',
  },
  clImplicitDeclaration: {
    what: 'The function is used before it is declared.',
    cause:
      'The compiler saw a call before any declaration, so it cannot check the arguments. This is ' +
      'an error in current C.',
    next: 'Add the header that declares it, or declare the function above the first call.',
  },
  clTooFewArguments: {
    what: 'The call has too few arguments.',
    cause: 'The function takes {expected}, but the call gave {have}.',
    next: 'Add the missing arguments.',
  },
  clTooManyArguments: {
    what: 'The call has too many arguments.',
    cause: 'The function takes {expected}, but the call gave {have}.',
    next: 'Remove the extra arguments, or change the function.',
  },
  clNoMatchingFunction: {
    what: 'No version of {name} fits these arguments.',
    cause: "The call's argument types or count match none of the overloads.",
    next: 'Read the notes under the error for each candidate and compare the types.',
  },
  clNoMember: {
    what: 'The type {type} has no member named {name}.',
    cause: 'The member is misspelled or belongs to a different type.',
    next: "Check the spelling against the type's definition.",
  },
  clInvalidOperands: {
    what: 'The operator cannot be used with {left} and {right}.',
    cause: 'These 2 types have no definition for this operator.',
    next: 'Convert one side, or compare strings with strcmp or std::string.',
  },
  clCannotInitialize: {
    what: 'A {from} cannot start a variable of type {to}.',
    cause: 'The types do not match, for example text assigned to a number.',
    next: 'Change the type of the variable or the value.',
  },
  clIntToPointer: {
    what: 'An integer is used as a pointer.',
    cause: 'A number was assigned to a pointer, which is almost always a mistake.',
    next: 'Check for a missing & or *, or a missing cast.',
  },
  clPointerTypes: {
    what: 'The pointer types do not match.',
    cause: 'One pointer type was given where another is expected.',
    next: 'Make the types the same, or add a cast if you know it is safe.',
  },
  clAssigning: {
    what: 'A {from} cannot be assigned to {to}.',
    cause: 'The types do not fit each other.',
    next: 'Change the type, or convert the value first.',
  },
  clUnusedVariable: {
    what: 'The variable {name} is never used.',
    cause: 'It is declared and nothing reads it. This is a warning.',
    next: 'Remove it, or use it.',
  },
  clUninitialized: {
    what: 'The variable {name} is read before it has a value.',
    cause: 'Local variables hold garbage until you assign them.',
    next: 'Give {name} a value when you declare it, such as int total = 0.',
  },
  clControlReachesEnd: {
    what: 'A function can end without returning a value.',
    cause: 'Some path through a function that promises a value reaches the end without a return.',
    next: 'Add a return at the end, and check each branch.',
  },
  clNonVoidNoReturn: {
    what: 'The function must return a value.',
    cause: 'A function with a return type other than void has a return with no value, or none.',
    next: 'Return a value, such as return 0.',
  },
  clVoidReturnsValue: {
    what: 'The function {name} returns nothing but is given a value.',
    cause: 'A void function cannot send back a value.',
    next: 'Remove the value after return, or change the return type.',
  },
  clRedefinition: {
    what: 'The name {name} is defined twice.',
    cause: 'The same name is declared twice in one scope, or a header was included twice without a guard.',
    next: 'Rename one, or remove the repeat.',
  },
  clConflictingTypes: {
    what: 'The function {name} is declared 2 different ways.',
    cause: 'The declaration and the definition disagree on types or the number of parameters.',
    next: 'Make the 2 match.',
  },
  clFormatMismatch: {
    what: 'The format code does not match the value.',
    cause: 'printf and scanf read the type from the code. This one wants {expected} and got {given}.',
    next: 'Use the code that fits: %d for int, %f for double, %s for text, %c for a character.',
  },
  clFormatArguments: {
    what: 'The format string and the values do not match in number.',
    cause: 'There are more percent codes than values, or the other way.',
    next: 'Count the codes and the values after the string.',
  },
  clExpressionUnused: {
    what: 'The result of this expression is not used.',
    cause:
      'The line calculates something and throws it away. A missing assignment or a comparison ' +
      'used as a statement is common.',
    next: 'Assign the result, or remove the line. For a comparison, check for = and ==.',
  },
} as const;
