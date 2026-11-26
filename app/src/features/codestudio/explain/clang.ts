// The 60 clang diagnostics people meet most (DESIGN 7.2). Messages are the texts in clang's diagnostic definitions
// (DiagnosticParseKinds, DiagnosticSemaKinds, DiagnosticLexKinds), with the parts that vary filled in. The cleaned
// message has no file, line, or `error:` prefix and no trailing `[-Wflag]`.

import { entry, type CatalogEntry } from './types';

export const CLANG_ENTRIES: readonly CatalogEntry[] = [
  entry('clUndeclared', /^use of undeclared identifier '(?<name>[^']+)'/, [
    "use of undeclared identifier 'prinf'",
    "use of undeclared identifier 'x'",
  ]),
  entry('clExpectedSemicolonExpr', /^expected ';' after (?<what>expression|return statement|[a-z ]+ statement)/, [
    "expected ';' after expression",
    "expected ';' after return statement",
  ]),
  entry('clExpectedSemicolonDecl', /^expected ';' at end of declaration/, ["expected ';' at end of declaration"]),
  entry('clExpectedSemicolonStruct', /^expected ';' after (?:struct|class|union|enum)/, ["expected ';' after struct"]),
  entry('clExpectedParen', /^expected '\)'/, ["expected ')'"]),
  entry('clExpectedBrace', /^expected '\}'/, ["expected '}'"]),
  entry('clExpectedExpression', /^expected expression/, ['expected expression']),
  entry('clExpectedIdentifier', /^expected identifier or '\('/, ["expected identifier or '('"]),
  entry('clExpectedUnqualified', /^expected unqualified-id/, ['expected unqualified-id']),
  entry('clExpectedType', /^expected a type/, ['expected a type']),
  entry('clUnknownType', /^unknown type name '(?<name>[^']+)'/, [
    "unknown type name 'string'",
    "unknown type name 'bool'",
  ]),
  entry(
    'clImplicitDeclaration',
    /^(?:implicit declaration of function '(?<name>[^']+)'|call to undeclared function '(?<other>[^']+)')/,
    [
      "implicit declaration of function 'foo' is invalid in C99",
      "call to undeclared function 'foo'; ISO C99 and later do not support implicit function declarations",
    ],
  ),
  entry('clTooFewArguments', /^too few arguments to function call, expected (?<expected>\d+), have (?<have>\d+)/, [
    'too few arguments to function call, expected 2, have 1',
  ]),
  entry('clTooManyArguments', /^too many arguments to function call, expected (?<expected>\d+), have (?<have>\d+)/, [
    'too many arguments to function call, expected 1, have 2',
  ]),
  entry('clNoMatchingFunction', /^no matching function for call to '(?<name>[^']+)'/, [
    "no matching function for call to 'area'",
  ]),
  entry('clNoMember', /^no member named '(?<name>[^']+)' in '(?<type>[^']+)'/, [
    "no member named 'lenght' in 'std::vector<int>'",
  ]),
  entry('clInvalidOperands', /^invalid operands to binary expression \('(?<left>[^']+)' and '(?<right>[^']+)'\)/, [
    "invalid operands to binary expression ('int' and 'const char *')",
  ]),
  entry(
    'clCannotInitialize',
    /^cannot initialize [a-z ]+ of type '(?<to>[^']+)' with an? [lr]value of type '(?<from>[^']+)'/,
    [
      "cannot initialize a variable of type 'int' with an lvalue of type 'const char[3]'",
      "cannot initialize a variable of type 'char *' with an rvalue of type 'int'",
    ],
  ),
  entry(
    'clIntToPointer',
    /^incompatible integer to pointer conversion (?<where>[^']+)'(?<to>[^']+)' from '(?<from>[^']+)'/,
    ["incompatible integer to pointer conversion assigning to 'char *' from 'int'"],
  ),
  entry('clPointerTypes', /^incompatible pointer types (?<where>[^']+)'(?<to>[^']+)' from '(?<from>[^']+)'/, [
    "incompatible pointer types assigning to 'int *' from 'char *'",
  ]),
  entry('clAssigning', /^assigning to '(?<to>[^']+)' from incompatible type '(?<from>[^']+)'/, [
    "assigning to 'int' from incompatible type 'char *'",
  ]),
  entry('clUnusedVariable', /^unused variable '(?<name>[^']+)'/, ["unused variable 'count'"]),
  entry('clUninitialized', /^variable '(?<name>[^']+)' is uninitialized when used here/, [
    "variable 'total' is uninitialized when used here",
  ]),
  entry('clControlReachesEnd', /^control reaches end of non-void function/, [
    'control reaches end of non-void function',
  ]),
  entry(
    'clNonVoidNoReturn',
    /^non-void function(?: '(?<name>[^']+)')? (?:does not return a value|should return a value)/,
    ["non-void function 'main' should return a value", 'non-void function does not return a value'],
  ),
  entry('clVoidReturnsValue', /^void function '(?<name>[^']+)' should not return a value/, [
    "void function 'show' should not return a value",
  ]),
  entry('clRedefinition', /^redefinition of '(?<name>[^']+)'/, ["redefinition of 'x'", "redefinition of 'main'"]),
  entry('clConflictingTypes', /^conflicting types for '(?<name>[^']+)'/, ["conflicting types for 'area'"]),
  entry('clFormatMismatch', /^format specifies type '(?<expected>[^']+)' but the argument has type '(?<given>[^']+)'/, [
    "format specifies type 'int' but the argument has type 'char *'",
    "format specifies type 'char *' but the argument has type 'int'",
  ]),
  entry('clFormatArguments', /^(?:more '%' conversions than data arguments|data argument not used by format string)/, [
    "more '%' conversions than data arguments",
    'data argument not used by format string',
  ]),
  entry('clExpressionUnused', /^expression result unused/, ['expression result unused']),
  entry('clPointerIntCompare', /^comparison between pointer and integer/, [
    "comparison between pointer and integer ('char *' and 'int')",
  ]),
  entry('clAssignInCondition', /^using the result of an assignment as a condition without parentheses/, [
    'using the result of an assignment as a condition without parentheses',
  ]),
  entry('clArrayPastEnd', /^array index (?<index>-?\d+) is past the end of the array/, [
    'array index 5 is past the end of the array (that has 5 elements)',
  ]),
  entry(
    'clConstAssign',
    /^cannot assign to (?:variable|non-static data member) '(?<name>[^']+)' with const-qualified type/,
    ["cannot assign to variable 'limit' with const-qualified type 'const int'"],
  ),
  entry('clNotAssignable', /^expression is not assignable/, ['expression is not assignable']),
  entry('clFileNotFound', /^'(?<name>[^']+)' file not found/, ["'vector.h' file not found", "'foo.h' file not found"]),
  entry('clMissingQuote', /^missing terminating '(?<quote>["'])' character/, [
    `missing terminating '"' character`,
    "missing terminating ''' character",
  ]),
  entry('clExtraBrace', /^extraneous closing brace/, ["extraneous closing brace ('}')"]),
  entry(
    'clBindTemporary',
    /^non-const lvalue reference to type '(?<type>[^']+)' cannot bind to a temporary of type '(?<from>[^']+)'/,
    ["non-const lvalue reference to type 'int' cannot bind to a temporary of type 'long'"],
  ),
  entry('clNoViableConversion', /^no viable conversion from '(?<from>[^']+)' to '(?<to>[^']+)'/, [
    "no viable conversion from 'const char[6]' to 'int'",
  ]),
  entry('clNoViableOverload', /^no viable overloaded '(?<op>[^']+)'/, [
    "no viable overloaded '='",
    "no viable overloaded '<<'",
  ]),
  entry('clAmbiguous', /^reference to '(?<name>[^']+)' is ambiguous/, ["reference to 'count' is ambiguous"]),
  entry('clIncompleteMember', /^member access into incomplete type '(?<type>[^']+)'/, [
    "member access into incomplete type 'struct node'",
  ]),
  entry('clIncompleteVariable', /^variable has incomplete type '(?<type>[^']+)'/, [
    "variable has incomplete type 'struct item'",
  ]),
  entry('clNonStaticMember', /^call to non-static member function without an object argument/, [
    'call to non-static member function without an object argument',
  ]),
  entry('clShadow', /^declaration shadows a (?:local variable|variable in the global namespace|field)/, [
    'declaration shadows a local variable',
  ]),
  entry('clExcessElements', /^excess elements in (?<what>array|scalar|struct) initializer/, [
    'excess elements in array initializer',
  ]),
  entry('clInitializerNotConstant', /^initializer element is not a compile-time constant/, [
    'initializer element is not a compile-time constant',
  ]),
  entry('clBreakOutside', /^'(?<word>break|continue)' statement not in (?:loop|switch)/, [
    "'break' statement not in loop or switch statement",
    "'continue' statement not in loop statement",
  ]),
  entry(
    'clAbstract',
    /^(?:cannot declare variable '(?<name>[^']+)' to be of abstract type|allocating an object of abstract class type)/,
    ["cannot declare variable 'shape' to be of abstract type 'Shape'"],
  ),
  entry('clPrivateMember', /^'(?<name>[^']+)' is a (?<access>private|protected) member of '(?<type>[^']+)'/, [
    "'size' is a private member of 'Stack'",
  ]),
  entry('clBraceInit', /^non-aggregate type '(?<type>[^']+)' cannot be initialized with an initializer list/, [
    "non-aggregate type 'Point' cannot be initialized with an initializer list",
  ]),
  entry('clUnknownEscape', /^unknown escape sequence '(?<seq>[^']+)'/, ["unknown escape sequence '\\q'"]),
  entry('clMultiChar', /^(?:multi-character character constant|empty character constant)/, [
    'multi-character character constant',
    'empty character constant',
  ]),
  entry('clPrecisionLoss', /^implicit conversion (?:loses integer precision|from '[^']+' to '[^']+' changes value)/, [
    "implicit conversion loses integer precision: 'long' to 'int'",
    "implicit conversion from 'double' to 'int' changes value from 2.5 to 2",
  ]),
  entry('clAlwaysResult', /^result of comparison (?:of|is always) /, [
    'result of comparison of unsigned expression < 0 is always false',
    'result of comparison is always false',
  ]),
  entry(
    'clStringCompare',
    /^(?:result of comparison against a string literal is unspecified|comparison of array '[^']+' equal to a null pointer)/,
    [
      'result of comparison against a string literal is unspecified (use an explicit string comparison function instead)',
    ],
  ),
  entry(
    'clMissingReturnType',
    /^(?:type specifier missing, defaults to 'int'|C\+\+ requires a type specifier for all declarations)/,
    ["type specifier missing, defaults to 'int'", 'C++ requires a type specifier for all declarations'],
  ),
  entry('clMainReturn', /^(?:return type of 'main' is not 'int'|'main' must return 'int')/, [
    "return type of 'main' is not 'int'",
  ]),
  entry(
    'clStackAddress',
    /^(?:address of stack memory associated with local variable '(?<name>[^']+)' returned|returning address of local variable)/,
    ["address of stack memory associated with local variable 'buffer' returned"],
  ),
];
