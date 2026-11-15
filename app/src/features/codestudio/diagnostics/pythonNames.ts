// Names Python defines without an import: the built-in functions, constants, types, and exceptions that the Python
// 3.12 library reference lists under "Built-in Functions", "Built-in Constants", and "Built-in Exceptions", plus the
// module attributes every module has.

const FUNCTIONS =
  'abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex ' +
  'delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex ' +
  'id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow ' +
  'print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars ' +
  'zip __import__';

const CONSTANTS = 'False True None NotImplemented Ellipsis __debug__ quit exit copyright credits license';

const EXCEPTIONS =
  'BaseException BaseExceptionGroup GeneratorExit KeyboardInterrupt SystemExit Exception ArithmeticError ' +
  'FloatingPointError OverflowError ZeroDivisionError AssertionError AttributeError BufferError EOFError ' +
  'ExceptionGroup ImportError ModuleNotFoundError LookupError IndexError KeyError MemoryError NameError ' +
  'UnboundLocalError OSError BlockingIOError ChildProcessError ConnectionError BrokenPipeError ' +
  'ConnectionAbortedError ConnectionRefusedError ConnectionResetError FileExistsError FileNotFoundError ' +
  'InterruptedError IsADirectoryError NotADirectoryError PermissionError ProcessLookupError TimeoutError ' +
  'ReferenceError RuntimeError NotImplementedError PythonFinalizationError RecursionError StopAsyncIteration ' +
  'StopIteration SyntaxError IndentationError TabError SystemError TypeError ValueError UnicodeError ' +
  'UnicodeDecodeError UnicodeEncodeError UnicodeTranslateError Warning BytesWarning DeprecationWarning ' +
  'EncodingWarning FutureWarning ImportWarning PendingDeprecationWarning ResourceWarning RuntimeWarning ' +
  'SyntaxWarning UnicodeWarning UserWarning EnvironmentError IOError';

const MODULE = '__name__ __file__ __doc__ __package__ __spec__ __loader__ __builtins__ __annotations__ __path__';

export const PYTHON_BUILTINS: ReadonlySet<string> = new Set(
  [FUNCTIONS, CONSTANTS, EXCEPTIONS, MODULE].join(' ').split(' '),
);
