// Explanations for the catalog entries of code:L11 (Python's exception classes, one entry each).
// Each has what happened, the likely cause, and what to try.

export const explainPythonClasses = {
  pyClassKeyError: {
    what: 'A dictionary key was not found.',
    cause: 'The key was not added, or it is spelled differently.',
    next: 'Print the dictionary\'s keys. Use get() or "in" to check first.',
  },
  pyClassIndexError: {
    what: 'A position is outside the sequence.',
    cause: 'The index is bigger than the last item, or the sequence is empty.',
    next: 'Check len() of the sequence before this line.',
  },
  pyClassNameError: {
    what: 'A name is used that does not exist.',
    cause: 'The name is misspelled or was never given a value.',
    next: 'Check the spelling and the order of the lines.',
  },
  pyClassAttributeError: {
    what: 'An object does not have that attribute.',
    cause: 'The name is misspelled, or the object is a different type than expected.',
    next: 'Print type(x) and dir(x).',
  },
  pyClassTypeError: {
    what: 'A value is the wrong type for this operation.',
    cause: 'The code used a value in a way its type does not allow.',
    next: 'Read the message for the types. Print both with type().',
  },
  pyClassValueError: {
    what: 'A value has the right type but a wrong content.',
    cause: 'A function got an argument it cannot use, such as text that is not a number.',
    next: 'Check the input before the call, or catch ValueError.',
  },
  pyClassZeroDivisionError: {
    what: 'The code divides by zero.',
    cause: 'The bottom number was 0.',
    next: 'Check the divisor before dividing.',
  },
  pyClassOverflowError: {
    what: 'A number is too big.',
    cause: 'The result is larger than this type can hold.',
    next: 'Use smaller numbers or an integer, which has no limit.',
  },
  pyClassFloatingPointError: {
    what: 'A decimal calculation failed.',
    cause: 'A floating point check that is turned on found an invalid result.',
    next: 'Check for division by zero or very large values.',
  },
  pyClassArithmeticError: {
    what: 'A calculation failed.',
    cause: 'A number operation went wrong, such as dividing by zero or growing too large.',
    next: 'Read the message after the class name for the exact reason.',
  },
  pyClassLookupError: {
    what: 'A key or an index was not found.',
    cause: 'The key or position is not in the collection.',
    next: 'Check that it exists first.',
  },
  pyClassImportError: {
    what: 'An import failed.',
    cause: 'The name is missing from the module or the module could not load.',
    next: 'Check the spelling in the import line.',
  },
  pyClassModuleNotFoundError: {
    what: 'Python cannot find that module.',
    cause: 'The module name is misspelled or it is not installed in this runtime.',
    next: 'Check the spelling and the Packs list.',
  },
  pyClassFileNotFoundError: {
    what: 'The file does not exist.',
    cause: 'The path is wrong or the file is not part of the project.',
    next: 'Check the name and folder.',
  },
  pyClassFileExistsError: {
    what: 'The file already exists.',
    cause: 'The code tried to create something that is already there.',
    next: 'Choose another name or check first.',
  },
  pyClassIsADirectoryError: {
    what: 'The path is a folder, not a file.',
    cause: 'The code tried to open a folder as if it were a file.',
    next: 'Add the file name to the path.',
  },
  pyClassNotADirectoryError: {
    what: 'The path is a file, not a folder.',
    cause: 'The code treated a file as a folder.',
    next: 'Check each part of the path.',
  },
  pyClassPermissionError: {
    what: 'The program is not allowed to do that.',
    cause: 'The sandbox does not give access to this file or action.',
    next: 'Use files inside your project only.',
  },
  pyClassTimeoutError: {
    what: 'An operation took too long.',
    cause: 'A wait ended before the answer came.',
    next: 'Run it again, or reduce the work.',
  },
  pyClassConnectionError: {
    what: 'A network connection failed.',
    cause: 'Programs here run offline and cannot reach the network.',
    next: 'Use data from your project instead.',
  },
  pyClassOSError: {
    what: 'The operating system refused an operation.',
    cause: 'A file or a system call failed.',
    next: 'Read the message after the class name for the reason.',
  },
  pyClassEOFError: {
    what: 'The input ended too early.',
    cause: 'The program asked for input that is not there.',
    next: 'Fill in the Stdin box with one line per input() call.',
  },
  pyClassMemoryError: {
    what: 'The program ran out of memory.',
    cause: 'The data got too big for the memory limit.',
    next: 'Work with less data at a time.',
  },
  pyClassBufferError: {
    what: 'A buffer operation is not allowed.',
    cause: 'Code tried to resize or reuse a buffer that is in use.',
    next: 'Release the buffer before changing it.',
  },
  pyClassReferenceError: {
    what: 'A weak reference points to an object that is gone.',
    cause: 'The object was removed before the reference was used.',
    next: 'Keep a normal reference to it.',
  },
  pyClassRuntimeError: {
    what: 'Something went wrong while running.',
    cause: 'The runtime found a problem that no other error class fits.',
    next: 'Read the message after the class name for the reason.',
  },
  pyClassNotImplementedError: {
    what: 'This part is not written yet.',
    cause: 'A method that must be filled in by a subclass was called.',
    next: 'Write that method in your class.',
  },
  pyClassRecursionError: {
    what: 'A function called itself too many times.',
    cause: 'There is no stopping case.',
    next: 'Add a base case that returns without calling again.',
  },
  pyClassStopAsyncIteration: {
    what: 'An async loop ran out of items.',
    cause: 'An asynchronous iterator has nothing more to give.',
    next: 'Use async for, which handles the end for you.',
  },
  pyClassUnboundLocalError: {
    what: 'A local name is used before it has a value.',
    cause: 'A name assigned inside a function counts as local for the whole function.',
    next: 'Give it a value before this line.',
  },
  pyClassUnicodeError: {
    what: 'Text could not be converted between characters and bytes.',
    cause: 'The bytes do not match the encoding used to read them.',
    next: 'Say the encoding, such as encoding="utf-8".',
  },
  pyClassSyntaxError: {
    what: 'The code breaks a grammar rule.',
    cause: 'A colon, bracket, quote, or comma is missing or extra.',
    next: 'Check this line and the one above it.',
  },
  pyClassIndentationError: {
    what: 'The indentation is wrong.',
    cause: 'A line is indented too far, too little, or not at all.',
    next: 'Line up each block with 4 spaces.',
  },
  pyClassTabError: {
    what: 'Tabs and spaces are mixed.',
    cause: 'One block uses both for indentation.',
    next: 'Use only spaces.',
  },
  pyClassSystemError: {
    what: 'Python found a problem inside itself.',
    cause: 'This is rarely your code.',
    next: 'Run the program again, and report it if it repeats.',
  },
  pyClassKeyboardInterrupt: {
    what: 'The run was stopped.',
    cause: 'Stop was pressed, or the time limit was reached.',
    next: 'Run it again. Check for a loop that never ends.',
  },
  pyClassSystemExit: {
    what: 'The program asked to exit.',
    cause: 'exit() or sys.exit() was called.',
    next: 'This is normal when you call it on purpose.',
  },
  pyClassGeneratorExit: {
    what: 'A generator was closed.',
    cause: 'The code that used the generator stopped asking for values.',
    next: 'Let the generator finish, or handle the close with try and finally.',
  },
  pyClassException: {
    what: 'An error was raised.',
    cause: 'The program raised an error with this message.',
    next: 'Read the message, then check the line shown.',
  },
} as const;
