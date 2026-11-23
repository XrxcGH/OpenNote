// Explanations for the catalog entries of code:L11 (clang diagnostics, second half): what happened, the likely cause, and what to try.

export const explainClangMore = {
  clPointerIntCompare: {
    what: 'A pointer is compared with an integer.',
    cause: 'A pointer and a number cannot be compared directly.',
    next: 'Compare with NULL or nullptr, or dereference the pointer with *.',
  },
  clAssignInCondition: {
    what: 'An assignment is used as a condition.',
    cause: '= stores a value and == compares. The compiler suspects you meant to compare.',
    next: 'Change = to ==, or add a second pair of parentheses if you mean it.',
  },
  clArrayPastEnd: {
    what: 'The index {index} is past the end of the array.',
    cause: 'Valid positions run from 0 to one less than the size.',
    next: 'Use an index inside that range.',
  },
  clConstAssign: {
    what: 'The variable {name} is const and cannot change.',
    cause: 'A const variable cannot be assigned after its declaration.',
    next: 'Remove const, or do not assign to it.',
  },
  clNotAssignable: {
    what: 'The left side cannot be assigned to.',
    cause: 'The left of = must be a variable, an array item, or a member.',
    next: 'Put a variable on the left. If you meant to compare, use ==.',
  },
  clFileNotFound: {
    what: 'The file {name} cannot be found.',
    cause: 'The include names a file that is not in the project or the standard library.',
    next: 'Check the spelling. Use angle brackets for standard headers and quotes for your own files.',
  },
  clMissingQuote: {
    what: 'A string or character is not closed.',
    cause: 'A quote opened and the line ended without a matching quote.',
    next: 'Add the closing quote.',
  },
  clExtraBrace: {
    what: 'There is a closing brace with no opening one.',
    cause: 'A block was closed twice, or an opening brace is missing.',
    next: 'Remove the extra brace, or add the opening one.',
  },
  clBindTemporary: {
    what: 'A temporary value cannot be given to a non-const reference.',
    cause: 'The value has no name, so a reference that could change it makes no sense.',
    next: 'Make the reference const, or pass a named variable.',
  },
  clNoViableConversion: {
    what: 'A {from} cannot be converted to {to}.',
    cause: 'No conversion is defined between these types.',
    next: 'Convert it yourself, or change the type.',
  },
  clNoViableOverload: {
    what: 'The operator {op} does not work with these types.',
    cause: 'No version of the operator takes these operand types.',
    next: 'Check the types on both sides, and include the header that defines the operator.',
  },
  clAmbiguous: {
    what: 'The name {name} could mean more than one thing.',
    cause: 'The file sees 2 declarations, for example your variable and one from the std namespace.',
    next: 'Rename yours, or write std:: or :: in front to say which.',
  },
  clIncompleteMember: {
    what: 'The type is only declared, not defined.',
    cause: 'The compiler saw {type} announced but never given its fields.',
    next: 'Include the header that defines it, or define it before this point.',
  },
  clIncompleteVariable: {
    what: 'The type {type} is not fully defined.',
    cause: 'A variable needs the complete type to know its size.',
    next: 'Include the header that defines the type.',
  },
  clNonStaticMember: {
    what: 'A method is called without an object.',
    cause: 'An ordinary member function needs an object to work on.',
    next: 'Create an object and call it with a dot, or make the function static.',
  },
  clShadow: {
    what: 'A name hides another one.',
    cause: 'A variable has the same name as one in an outer scope.',
    next: 'Rename one of them to avoid mix-ups.',
  },
  clExcessElements: {
    what: 'There are too many values in the initializer.',
    cause: 'The braces hold more values than the {what} has room for.',
    next: 'Remove values, or make the {what} bigger.',
  },
  clInitializerNotConstant: {
    what: 'The starting value must be known when compiling.',
    cause: 'A global or static variable can only start with a constant.',
    next: 'Assign it inside a function, or use a constant.',
  },
  clBreakOutside: {
    what: '{word} is used outside a loop.',
    cause: 'break and continue only work inside a loop, and break also works in switch.',
    next: 'Move it inside a loop, or use return.',
  },
  clAbstract: {
    what: 'An object of an abstract class cannot be made.',
    cause: 'The class has methods with no body.',
    next: 'Create an object of a subclass that defines all of them.',
  },
  clPrivateMember: {
    what: 'The member {name} is {access}.',
    cause: "Only the class's own code can use {access} members.",
    next: 'Use a public method, or change the access.',
  },
  clBraceInit: {
    what: 'A list of values cannot start a {type}.',
    cause: 'The type has constructors or private data, so it is not a plain collection of fields.',
    next: 'Call a constructor, such as {type}(1, 2).',
  },
  clUnknownEscape: {
    what: 'The escape {seq} is not known.',
    cause: 'Only a few backslash codes exist, such as \\n, \\t, \\\\, and \\".',
    next: 'Use a valid code, or write \\\\ for a backslash.',
  },
  clMultiChar: {
    what: 'A character constant must hold one character.',
    cause: 'Single quotes are for one character. Several characters, or none, do not fit.',
    next: 'Use double quotes for text.',
  },
  clPrecisionLoss: {
    what: 'A value is squeezed into a smaller type.',
    cause: 'The conversion can lose digits or the decimal part.',
    next: 'Use the bigger type, or convert on purpose with a cast.',
  },
  clAlwaysResult: {
    what: 'This comparison always gives the same answer.',
    cause: 'An unsigned number is never below 0, or the 2 sides cannot differ.',
    next: 'Check the types and the comparison.',
  },
  clStringCompare: {
    what: 'Strings are compared by address, not text.',
    cause: '== on char pointers checks whether they are the same place.',
    next: 'Use strcmp, or std::string.',
  },
  clMissingReturnType: {
    what: 'A function is missing its return type.',
    cause: 'Every function needs a type before its name.',
    next: 'Add the type, such as int or void.',
  },
  clMainReturn: {
    what: 'main must return int.',
    cause: "The program's entry point has a fixed signature.",
    next: 'Write int main().',
  },
  clStackAddress: {
    what: 'A pointer to a local variable is returned.',
    cause: 'The variable is gone when the function ends, so the pointer points at nothing.',
    next: 'Return a value, allocate with malloc, or pass a buffer in.',
  },
} as const;
