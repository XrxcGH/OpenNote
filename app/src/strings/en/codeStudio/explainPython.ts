// Explanations for the catalog entries of code:L11 (Python's specific messages and syntax errors).
// Each has what happened, the likely cause, and what to try.

export const explainPython = {
  pyNameNotDefined: {
    what: 'The name {name} does not exist.',
    cause:
      'Python met {name} before anything gave it a value. The usual causes are a typo, a missing ' +
      'import, or a variable that is only set inside another function.',
    next:
      'Check the spelling. If it is a module, add its import at the top. Make sure the line that ' +
      'sets {name} runs before this one.',
  },
  pyUnboundLocal: {
    what: '{name} is used before it gets a value.',
    cause:
      'A function that assigns {name} anywhere treats it as local for the whole function, so ' +
      'reading it first fails.',
    next:
      'Give {name} a value before this line, or add "global {name}" at the top of the function if' +
      ' you mean the outer one.',
  },
  pyIndexOutOfRange: {
    what: 'The position is past the end of the {kind}.',
    cause:
      'Positions start at 0, so a {kind} with 3 items has positions 0, 1, and 2. The code asked ' +
      'for one that does not exist.',
    next:
      'Print len() of the {kind} just before this line. In a loop, use range(len(x)) and not ' + 'range(len(x) + 1).',
  },
  pyPopEmpty: {
    what: 'The list is empty, so there is nothing to remove.',
    cause: 'pop() takes the last item, and an empty list has none.',
    next: 'Check "if items:" before calling pop(), or fill the list first.',
  },
  pyKeyMissing: {
    what: 'The dictionary has no key {key}.',
    cause:
      'Looking up a key that was never added raises KeyError. The key may be misspelled or have ' +
      'different letter case.',
    next:
      'Use d.get(key) to get None instead of an error, or test "key in d" first. Print d.keys() ' +
      'to see what is there.',
  },
  pyDivideByZero: {
    what: 'The code divides by zero.',
    cause: 'The bottom number of a division, a floor division, or a remainder was 0.',
    next:
      'Check that the divisor is not 0 before dividing. Print it just before this line to see ' +
      'where the 0 comes from.',
  },
  pyAttributeNone: {
    what: 'The value is None, and None has no {name}.',
    cause:
      'A function that does not return anything gives back None. Methods such as list.sort() ' +
      'change the list and return None.',
    next:
      'Look at the line that set this value. Do not assign the result of sort(), append(), or ' +
      'print(). Check that your function returns a value.',
  },
  pyModuleAttribute: {
    what: 'The module {module} has no {name}.',
    cause:
      'The name is misspelled, or your own file has the same name as the module and Python loaded' + ' yours instead.',
    next:
      "Check the spelling against the module's documentation. Rename your file if it shares the " + "module's name.",
  },
  pyAttributeMissing: {
    what: 'A {type} has no attribute {name}.',
    cause: 'The attribute name is misspelled, or this object is not the type you expected.',
    next: 'Check the spelling. Print type(x) and dir(x) to see what the object has.',
  },
  pyNotCallable: {
    what: 'A {type} cannot be called like a function.',
    cause:
      'Parentheses after a name call it. This name holds a {type}, often because a variable ' +
      'reused the name of a function.',
    next: 'Remove the parentheses, or rename the variable so it does not hide the function.',
  },
  pyNotSubscriptable: {
    what: 'A {type} cannot be indexed with square brackets.',
    cause: 'Brackets work on lists, strings, tuples, and dictionaries. This value is a {type}.',
    next: 'Print the value and its type() before this line. A function that returned None is a common' + ' cause.',
  },
  pyNotIterable: {
    what: 'A {type} cannot be looped over.',
    cause: 'for loops and functions such as list() need a collection. A single {type} is not one.',
    next:
      'Loop over range(n) for a number, or put the value in a list. Check that a function did not' +
      ' return a single item.',
  },
  pyUnsupportedOperand: {
    what: 'The operator {op} does not work between {left} and {right}.',
    cause: 'Python will not mix these 2 types in this operation, for example a number and text.',
    next: 'Convert one side first, such as int("5") or str(5). Print both types to see which one is ' + 'unexpected.',
  },
  pyConcatenate: {
    what: 'A {right} cannot be joined to a {left} with +.',
    cause: '+ joins values of the same kind only.',
    next: 'Convert it first, such as str(n), or build the text with an f-string.',
  },
  pyWrongArgCount: {
    what: '{fn}() was called with the wrong number of arguments.',
    cause:
      'The function takes {expected}, but the call gave {given}. For a method, Python passes self' +
      ' itself, so the definition needs it as its first parameter.',
    next:
      'Count the arguments in the call and in the def line. If this is a method, add self as the ' + 'first parameter.',
  },
  pyMissingArgument: {
    what: '{fn}() needs {count} more value(s): {names}.',
    cause: 'The call left out arguments the function requires.',
    next: 'Add the missing values to the call, or give those parameters default values in the def line.',
  },
  pyUnexpectedKeyword: {
    what: '{fn}() has no parameter named {name}.',
    cause: 'The keyword in the call does not match any name in the def line.',
    next: "Check the spelling against the function's parameters.",
  },
  pyBadUnaryOperand: {
    what: 'The sign {op} does not work on a {type}.',
    cause: 'Unary - and + need numbers.',
    next: 'Convert the value to a number first, such as int() or float().',
  },
  pyLenNoLength: {
    what: 'A {type} has no length.',
    cause: 'len() works on text, lists, tuples, dictionaries, and sets.',
    next: 'Use len(str(x)) to count digits, or pass a collection.',
  },
  pyUnhashable: {
    what: 'A {type} cannot be used as a dictionary key or in a set.',
    cause: 'Keys must never change. Lists, dictionaries, and sets can change, so Python refuses them.',
    next: 'Use a tuple instead of a list, or use a string or number as the key.',
  },
  pyBadIndexType: {
    what: 'Positions must be whole numbers.',
    cause: 'Square brackets with text or a decimal point in them work only on dictionaries.',
    next:
      'Convert with int(), or use // to divide to a whole number. For a dictionary, make sure the' +
      ' value really is one.',
  },
  pyIntInvalid: {
    what: '{text} is not a valid number for {fn}().',
    cause:
      'The text holds letters, spaces, or a decimal point that {fn}() cannot read. An empty ' + 'string fails too.',
    next:
      'Check the input before converting. Use .strip() to remove spaces, or wrap the call in try ' +
      'and except ValueError.',
  },
  pyFloatInvalid: {
    what: '{text} is not a number.',
    cause: 'float() can read digits with one decimal point, but not letters or commas.',
    next: 'Remove stray characters first, or catch ValueError and ask again.',
  },
  pyUnpack: {
    what: 'The number of values does not match the number of names.',
    cause: 'Unpacking such as a, b = values needs exactly as many values as names. This one needed ' + '{expected}.',
    next:
      'Print the value you are unpacking and count its items. Use a, *rest = values to take the ' +
      'first and keep the rest.',
  },
  pyMathDomain: {
    what: 'The math function got a value it cannot work with.',
    cause: 'sqrt() of a negative number and log() of zero or a negative are not defined for real numbers.',
    next: 'Check the value before calling. Use the cmath module if you need complex results.',
  },
  pyNotInList: {
    what: 'That value is not in the list.',
    cause: 'index() and remove() raise this error when the value is missing.',
    next: 'Test "value in items" first, or catch ValueError.',
  },
  pyModuleNotFound: {
    what: 'Python cannot find a module named {name}.',
    cause:
      'The module is misspelled, or it is not part of this runtime. Only the standard library and' +
      ' the installed packs are available.',
    next: 'Check the spelling. See the Packs list for what this runtime includes.',
  },
  pyImportName: {
    what: '{module} has no name {name} to import.',
    cause:
      'The name is misspelled, or it is in a different module. A file that imports itself in a ' +
      'loop causes this too.',
    next: "Check the spelling in the module's documentation.",
  },
  pyFileNotFound: {
    what: 'The file {path} does not exist here.',
    cause: 'The name or folder is wrong, or the file lives in your project and was not added to this run.',
    next:
      'Check the spelling and the folder. Open the file from the project, using its path from the' + ' project root.',
  },
  pyRecursionDepth: {
    what: 'A function called itself too many times.',
    cause:
      'Every call waits for the next one to finish. Without a stopping case, the calls pile up ' +
      'until Python gives up.',
    next: 'Add a base case that returns without calling again, and make sure each call moves toward it.',
  },
  pyEofInput: {
    what: 'The program asked for input and there is none left.',
    cause: 'input() read past the end of the Stdin text.',
    next: 'Fill in the Stdin box with one line for every input() call, or check the number of times ' + 'you ask.',
  },
  pyAssertionFailed: {
    what: 'An assert found a false condition.',
    cause: 'The condition after assert was false, so the program stopped on purpose.',
    next: 'Read the assert line. Print the values it checks to see which one is not what you expected.',
  },
  pyStopIteration: {
    what: 'next() ran out of items.',
    cause: 'An iterator or generator has nothing more to give.',
    next: 'Give next() a default, such as next(it, None), or check for the end before asking.',
  },
  pySyntaxColon: {
    what: 'A colon is missing.',
    cause: 'if, for, while, def, class, else, try, and with lines must end with a colon.',
    next: 'Add ":" at the end of the line.',
  },
  pySyntaxEquals: {
    what: 'A single = is used where a comparison belongs.',
    cause: '= stores a value. == compares 2 values.',
    next: 'Change = to == in the condition.',
  },
  pySyntaxNeverClosed: {
    what: 'The bracket {open} is never closed.',
    cause:
      'Every opening bracket needs a partner. The error line is where the bracket opens, but the ' +
      'mistake is often at the end of the block.',
    next: 'Add the closing bracket. Check that the pairs match in order.',
  },
  pySyntaxUnmatched: {
    what: 'The bracket {close} has no partner.',
    cause: 'A closing bracket appeared without an opening one before it, or one pair too many was closed.',
    next: 'Remove the extra bracket, or add the missing opening bracket.',
  },
  pySyntaxMismatch: {
    what: 'The bracket {close} does not match {open}.',
    cause: 'Brackets must close in the reverse order they opened.',
    next: 'Change {close} to the partner of {open}.',
  },
  pySyntaxString: {
    what: 'A string is not closed.',
    cause: 'A quote opened and the line ended before the matching quote.',
    next: 'Add the closing quote at the end of the text. Use triple quotes for text over several lines.',
  },
  pySyntaxPrint: {
    what: '{name} needs parentheses.',
    cause: 'In Python 3, print is a function and its values go inside parentheses.',
    next: 'Write print("text") instead of print "text".',
  },
  pySyntaxComma: {
    what: 'A comma may be missing.',
    cause: 'Values sit next to each other with no comma between them.',
    next: 'Add a comma between the items of the list, tuple, call, or dictionary.',
  },
  pySyntaxAssign: {
    what: 'A value cannot be assigned to {what}.',
    cause: 'The left side of = must be a name, an attribute, or an item, not a call or a literal.',
    next: 'Put a name on the left. If you meant to compare, use ==.',
  },
  pySyntaxOutside: {
    what: '{word} is used where it is not allowed.',
    cause: 'return belongs inside a function, and break and continue belong inside a loop.',
    next: 'Move the line inside the function or loop, or check the indentation above it.',
  },
  pySyntaxInvalid: {
    what: 'Python cannot read this line.',
    cause:
      'The line breaks a grammar rule. A missing colon, comma, quote, or bracket on this line or ' +
      'the one above is the usual cause.',
    next: 'Look at the line and the one before it. Check colons, commas, quotes, and brackets.',
  },
  pyIndentBlock: {
    what: 'A block is missing its indented body.',
    cause: 'After a line that ends with a colon, the next line must be indented.',
    next: 'Indent the next line, or write pass to leave the block empty for now.',
  },
  pyIndentUnexpected: {
    what: 'This line is indented too far.',
    cause: 'A line is indented without a colon line above it to start a block.',
    next: 'Remove the extra spaces so the line lines up with the one above.',
  },
  pyIndentUnindent: {
    what: 'The indentation does not line up with any block above.',
    cause: 'The line is indented to a depth that no earlier block uses.',
    next: 'Align it with an earlier line. Use 4 spaces for every level.',
  },
  pyTabMix: {
    what: 'Tabs and spaces are mixed in the indentation.',
    cause: 'Python cannot tell how deep a line is when the same block uses both.',
    next: 'Use only spaces. The Fix the indentation action converts tabs.',
  },
} as const;
