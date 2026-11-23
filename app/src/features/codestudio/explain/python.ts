// Python's errors (DESIGN 7.2). Messages are CPython 3.12's, as listed in the Python documentation for the built-in
// exceptions and in the 3.12 tokenizer and parser: the most specific messages first, then one entry per exception class.

import { entry, type CatalogEntry } from './types';

const CLASSES = [
  ['pyClassKeyError', 'KeyError'],
  ['pyClassIndexError', 'IndexError'],
  ['pyClassNameError', 'NameError'],
  ['pyClassAttributeError', 'AttributeError'],
  ['pyClassTypeError', 'TypeError'],
  ['pyClassValueError', 'ValueError'],
  ['pyClassZeroDivisionError', 'ZeroDivisionError'],
  ['pyClassOverflowError', 'OverflowError'],
  ['pyClassFloatingPointError', 'FloatingPointError'],
  ['pyClassArithmeticError', 'ArithmeticError'],
  ['pyClassLookupError', 'LookupError'],
  ['pyClassImportError', 'ImportError'],
  ['pyClassModuleNotFoundError', 'ModuleNotFoundError'],
  ['pyClassFileNotFoundError', 'FileNotFoundError'],
  ['pyClassFileExistsError', 'FileExistsError'],
  ['pyClassIsADirectoryError', 'IsADirectoryError'],
  ['pyClassNotADirectoryError', 'NotADirectoryError'],
  ['pyClassPermissionError', 'PermissionError'],
  ['pyClassTimeoutError', 'TimeoutError'],
  ['pyClassConnectionError', 'ConnectionError'],
  ['pyClassOSError', 'OSError'],
  ['pyClassEOFError', 'EOFError'],
  ['pyClassMemoryError', 'MemoryError'],
  ['pyClassBufferError', 'BufferError'],
  ['pyClassReferenceError', 'ReferenceError'],
  ['pyClassRuntimeError', 'RuntimeError'],
  ['pyClassNotImplementedError', 'NotImplementedError'],
  ['pyClassRecursionError', 'RecursionError'],
  ['pyClassStopAsyncIteration', 'StopAsyncIteration'],
  ['pyClassUnboundLocalError', 'UnboundLocalError'],
  ['pyClassUnicodeError', 'UnicodeDecodeError'],
  ['pyClassSyntaxError', 'SyntaxError'],
  ['pyClassIndentationError', 'IndentationError'],
  ['pyClassTabError', 'TabError'],
  ['pyClassSystemError', 'SystemError'],
  ['pyClassKeyboardInterrupt', 'KeyboardInterrupt'],
  ['pyClassSystemExit', 'SystemExit'],
  ['pyClassGeneratorExit', 'GeneratorExit'],
] as const;

const CLASS_NAMES: Record<string, string> = {
  UnicodeDecodeError: 'Unicode(?:Decode|Encode|Translate)?Error',
  ConnectionError: 'Connection(?:Aborted|Refused|Reset)?Error|BrokenPipeError',
  OSError: 'OSError|IOError|EnvironmentError|BlockingIOError|ChildProcessError|InterruptedError|ProcessLookupError',
};

export const PYTHON_ENTRIES: readonly CatalogEntry[] = [
  entry('pyNameNotDefined', /^NameError: name '(?<name>[^']+)' is not defined/, [
    "NameError: name 'pritn' is not defined. Did you mean: 'print'?",
    "NameError: name 'math' is not defined. Did you forget to import 'math'?",
  ]),
  entry('pyUnboundLocal', /^UnboundLocalError: (?:cannot access local variable|local variable) '(?<name>[^']+)'/, [
    "UnboundLocalError: cannot access local variable 'total' where it is not associated with a value",
    "UnboundLocalError: local variable 'total' referenced before assignment",
  ]),
  entry('pyIndexOutOfRange', /^IndexError: (?<kind>list|string|tuple) (?:assignment )?index out of range/, [
    'IndexError: list index out of range',
    'IndexError: string index out of range',
    'IndexError: tuple index out of range',
    'IndexError: list assignment index out of range',
  ]),
  entry('pyPopEmpty', /^IndexError: pop from (?:an )?empty/, ['IndexError: pop from empty list']),
  entry('pyKeyMissing', /^KeyError: (?<key>.+)/, ["KeyError: 'name'", 'KeyError: 3']),
  entry('pyDivideByZero', /^ZeroDivisionError: .*(?:division|modulo|zero)/, [
    'ZeroDivisionError: division by zero',
    'ZeroDivisionError: integer division or modulo by zero',
    'ZeroDivisionError: float division by zero',
    'ZeroDivisionError: integer modulo by zero',
  ]),
  entry('pyAttributeNone', /^AttributeError: 'NoneType' object has no attribute '(?<name>[^']+)'/, [
    "AttributeError: 'NoneType' object has no attribute 'append'",
  ]),
  entry('pyModuleAttribute', /^AttributeError: module '(?<module>[^']+)' has no attribute '(?<name>[^']+)'/, [
    "AttributeError: module 'math' has no attribute 'sqroot'",
  ]),
  entry('pyAttributeMissing', /^AttributeError: '(?<type>[^']+)' object has no attribute '(?<name>[^']+)'/, [
    "AttributeError: 'str' object has no attribute 'foo'",
    "AttributeError: 'list' object has no attribute 'apend'. Did you mean: 'append'?",
  ]),
  entry('pyNotCallable', /^TypeError: '(?<type>[^']+)' object is not callable/, [
    "TypeError: 'int' object is not callable",
    "TypeError: 'str' object is not callable",
  ]),
  entry('pyNotSubscriptable', /^TypeError: '(?<type>[^']+)' object is not subscriptable/, [
    "TypeError: 'int' object is not subscriptable",
    "TypeError: 'NoneType' object is not subscriptable",
  ]),
  entry('pyNotIterable', /^TypeError: '(?<type>[^']+)' object is not iterable/, [
    "TypeError: 'int' object is not iterable",
  ]),
  entry(
    'pyUnsupportedOperand',
    /^TypeError: unsupported operand type\(s\) for (?<op>[^:]+): '(?<left>[^']+)' and '(?<right>[^']+)'/,
    [
      "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
      "TypeError: unsupported operand type(s) for /: 'str' and 'int'",
    ],
  ),
  entry('pyConcatenate', /^TypeError: can only concatenate (?<left>\w+) \(not "(?<right>[^"]+)"\) to \w+/, [
    'TypeError: can only concatenate str (not "int") to str',
    'TypeError: can only concatenate list (not "int") to list',
  ]),
  entry(
    'pyWrongArgCount',
    /^TypeError: (?<fn>[\w.<>]+)\(\) takes (?<expected>[^]+?) but (?<given>\d+) (?:was|were) given/,
    [
      'TypeError: greet() takes 1 positional argument but 2 were given',
      'TypeError: area() takes 0 positional arguments but 1 was given',
      'TypeError: greet() takes from 1 to 2 positional arguments but 3 were given',
    ],
  ),
  entry(
    'pyMissingArgument',
    /^TypeError: (?<fn>[\w.<>]+)\(\) missing (?<count>\d+) required (?:positional|keyword-only) arguments?: (?<names>.+)/,
    [
      "TypeError: greet() missing 1 required positional argument: 'name'",
      "TypeError: add() missing 2 required positional arguments: 'a' and 'b'",
    ],
  ),
  entry('pyUnexpectedKeyword', /^TypeError: (?<fn>[\w.<>]+)\(\) got an unexpected keyword argument '(?<name>[^']+)'/, [
    "TypeError: greet() got an unexpected keyword argument 'nmae'",
  ]),
  entry('pyBadUnaryOperand', /^TypeError: bad operand type for unary (?<op>\S+): '(?<type>[^']+)'/, [
    "TypeError: bad operand type for unary -: 'str'",
  ]),
  entry('pyLenNoLength', /^TypeError: object of type '(?<type>[^']+)' has no len\(\)/, [
    "TypeError: object of type 'int' has no len()",
  ]),
  entry('pyUnhashable', /^TypeError: unhashable type: '(?<type>[^']+)'/, ["TypeError: unhashable type: 'list'"]),
  entry('pyBadIndexType', /^TypeError: (?:string|list|tuple) indices must be integers/, [
    "TypeError: string indices must be integers, not 'str'",
    'TypeError: list indices must be integers or slices, not str',
  ]),
  entry('pyIntInvalid', /^ValueError: invalid literal for (?<fn>int|float)\(\)(?: with base \d+)?: (?<text>.+)/, [
    "ValueError: invalid literal for int() with base 10: 'abc'",
    "ValueError: invalid literal for int() with base 10: ''",
  ]),
  entry('pyFloatInvalid', /^ValueError: could not convert string to float: (?<text>.+)/, [
    "ValueError: could not convert string to float: 'x'",
  ]),
  entry(
    'pyUnpack',
    /^ValueError: (?:too many values to unpack|not enough values to unpack) \(expected (?<expected>\d+)(?:, got (?<got>\d+))?\)/,
    [
      'ValueError: too many values to unpack (expected 2)',
      'ValueError: not enough values to unpack (expected 3, got 2)',
    ],
  ),
  entry('pyMathDomain', /^ValueError: math domain error/, ['ValueError: math domain error']),
  entry('pyNotInList', /^ValueError: (?:.+ is not in list|list\.remove\(x\): x not in list)/, [
    'ValueError: 3 is not in list',
    'ValueError: list.remove(x): x not in list',
  ]),
  entry('pyModuleNotFound', /^ModuleNotFoundError: No module named '(?<name>[^']+)'/, [
    "ModuleNotFoundError: No module named 'requests'",
  ]),
  entry('pyImportName', /^ImportError: cannot import name '(?<name>[^']+)' from '(?<module>[^']+)'/, [
    "ImportError: cannot import name 'sqroot' from 'math' (unknown location)",
  ]),
  entry('pyFileNotFound', /^FileNotFoundError: \[Errno 2\] No such file or directory: (?<path>.+)/, [
    "FileNotFoundError: [Errno 2] No such file or directory: 'data.txt'",
  ]),
  entry('pyRecursionDepth', /^RecursionError: maximum recursion depth exceeded/, [
    'RecursionError: maximum recursion depth exceeded',
    'RecursionError: maximum recursion depth exceeded while calling a Python object',
  ]),
  entry('pyEofInput', /^EOFError: EOF when reading a line/, ['EOFError: EOF when reading a line']),
  entry('pyAssertionFailed', /^AssertionError(?::|$)/, ['AssertionError', 'AssertionError: x should be positive']),
  entry('pyStopIteration', /^StopIteration(?::|$)/, ['StopIteration']),
  entry('pySyntaxColon', /^SyntaxError: expected ':'/, ["SyntaxError: expected ':'"]),
  entry('pySyntaxEquals', /^SyntaxError: invalid syntax\. Maybe you meant '==' or ':=' instead of '='\?/, [
    "SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?",
  ]),
  entry('pySyntaxNeverClosed', /^SyntaxError: '(?<open>[^']+)' was never closed/, [
    "SyntaxError: '(' was never closed",
    "SyntaxError: '[' was never closed",
  ]),
  entry('pySyntaxUnmatched', /^SyntaxError: unmatched '(?<close>[^']+)'/, ["SyntaxError: unmatched ')'"]),
  entry(
    'pySyntaxMismatch',
    /^SyntaxError: closing parenthesis '(?<close>[^']+)' does not match opening parenthesis '(?<open>[^']+)'/,
    ["SyntaxError: closing parenthesis ']' does not match opening parenthesis '('"],
  ),
  entry('pySyntaxString', /^SyntaxError: unterminated (?:triple-quoted )?string literal/, [
    'SyntaxError: unterminated string literal (detected at line 1)',
    'SyntaxError: unterminated triple-quoted string literal (detected at line 4)',
  ]),
  entry('pySyntaxPrint', /^SyntaxError: Missing parentheses in call to '(?<name>\w+)'/, [
    "SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?",
  ]),
  entry('pySyntaxComma', /^SyntaxError: invalid syntax\. Perhaps you forgot a comma\?/, [
    'SyntaxError: invalid syntax. Perhaps you forgot a comma?',
  ]),
  entry('pySyntaxAssign', /^SyntaxError: cannot assign to (?<what>.+?)(?: here\.| because|$)/, [
    "SyntaxError: cannot assign to function call here. Maybe you meant '==' instead of '='?",
    "SyntaxError: cannot assign to literal here. Maybe you meant '==' instead of '='?",
  ]),
  entry('pySyntaxOutside', /^SyntaxError: '(?<word>return|break|continue|yield|await)' (?:outside|not properly in)/, [
    "SyntaxError: 'return' outside function",
    "SyntaxError: 'break' outside loop",
  ]),
  entry('pySyntaxInvalid', /^SyntaxError: invalid syntax/, ['SyntaxError: invalid syntax']),
  entry('pyIndentBlock', /^IndentationError: expected an indented block/, [
    "IndentationError: expected an indented block after 'if' statement on line 1",
    'IndentationError: expected an indented block after function definition on line 3',
  ]),
  entry('pyIndentUnexpected', /^IndentationError: unexpected indent/, ['IndentationError: unexpected indent']),
  entry('pyIndentUnindent', /^IndentationError: unindent does not match any outer indentation level/, [
    'IndentationError: unindent does not match any outer indentation level',
  ]),
  entry('pyTabMix', /^TabError: inconsistent use of tabs and spaces in indentation/, [
    'TabError: inconsistent use of tabs and spaces in indentation',
  ]),
  // One entry for every other class of the CPython 3.12 exception hierarchy, found by name.
  ...CLASSES.map(([id, sample]) => entry(id, new RegExp(`^(?:${CLASS_NAMES[sample] ?? sample})(?::|$)`), [sample])),
  entry('pyClassException', /^(?:Base)?Exception(?::|$)/, ['Exception: example', 'BaseException: example']),
];
