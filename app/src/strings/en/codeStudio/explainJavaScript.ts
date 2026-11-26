// Explanations for the catalog entries of code:L11 (JavaScript errors).
// Each has what happened, the likely cause, and what to try.

export const explainJavaScript = {
  jsNotDefined: {
    what: 'The name {name} does not exist.',
    cause:
      'JavaScript met {name} before anything declared it. The usual causes are a typo, a missing ' +
      'let or const, or a variable that lives inside another function or block.',
    next: 'Check the spelling. Declare it with let or const before this line, in a scope that reaches here.',
  },
  jsBeforeInit: {
    what: '{name} is used before its declaration runs.',
    cause:
      'let and const names exist from the start of their block, but they hold no value until the ' +
      'declaration line runs.',
    next: 'Move the declaration above the first use.',
  },
  jsNotFunction: {
    what: '{name} is not a function.',
    cause:
      'The code calls {name} with parentheses, but it holds something else, or nothing. The name ' +
      'may be misspelled, or an earlier step may have returned undefined.',
    next: 'Print {name} with console.log. Check the spelling and what the earlier call returns.',
  },
  jsNotFunctionAnon: {
    what: 'The code calls something that is not a function.',
    cause: 'A call uses parentheses, but the value in front of them holds a number, text, an object, or nothing.',
    next: 'Print the value before the parentheses. Check the spelling and what the earlier step returned.',
  },
  jsConvertObject: {
    what: 'undefined or null was used where an object is needed.',
    cause: 'Functions such as Object.keys and Object.assign need an object. An earlier step gave nothing.',
    next: 'Print the value before this line. Give it a default value, such as an empty object.',
  },
  jsNotConstructorAnon: {
    what: 'The code uses new on something that is not a constructor.',
    cause: 'new works on classes and constructor functions. Arrow functions and plain objects do not qualify.',
    next: 'Call it without new, or write it as a class.',
  },
  jsClassNewAnon: {
    what: 'A class must be created with new.',
    cause: 'Classes cannot be called like plain functions.',
    next: 'Write new before the class name, as in new Cat().',
  },
  jsReadUndefined: {
    what: 'The code reads {name} from {what}.',
    cause:
      'Something earlier gave {what}, and {what} has no properties to read. Data that has not ' +
      'arrived yet or a misspelled name are common causes.',
    next:
      'Print the object before this line. Check the name that comes before .{name}. Use ' +
      'obj?.{name} to stop safely.',
  },
  jsSetUndefined: {
    what: 'The code sets {name} on {what}.',
    cause: 'The object that should hold it is {what}.',
    next: 'Assign an object to the name first, or check why it is missing.',
  },
  jsConstAssign: {
    what: 'A const cannot be given a new value.',
    cause: 'const fixes the binding. The line tries to assign to it again.',
    next: 'Change const to let if the value must change.',
  },
  jsNotIterable: {
    what: '{name} cannot be looped over.',
    cause:
      'for...of, spread, and destructuring with square brackets need an array, a string, or ' + 'another iterable.',
    next: 'Print the value. Use Object.keys(obj) or Object.entries(obj) for an object.',
  },
  jsDestructure: {
    what: '{source} is {what}, so {name} cannot be taken from it.',
    cause: 'Destructuring reads properties from a value, and {what} has none.',
    next: 'Check where {source} comes from, or give it a default such as = default value.',
  },
  jsNotConstructor: {
    what: '{name} cannot be used with new.',
    cause: 'new works on classes and constructor functions. Arrow functions and plain objects do not ' + 'qualify.',
    next: 'Call it without new, or write it as a class.',
  },
  jsClassNew: {
    what: 'The class {name} must be created with new.',
    cause: 'Classes cannot be called like plain functions.',
    next: 'Write new {name}(...).',
  },
  jsStackOverflow: {
    what: 'A function called itself too many times.',
    cause: 'Each call waits for the next one to finish. Without a stopping case they pile up until the' + ' limit.',
    next: 'Add a base case that returns without calling again.',
  },
  jsArrayLength: {
    what: 'The array length is not valid.',
    cause:
      'A length must be a whole number from 0 up to about 4 billion. A negative number or a ' + 'decimal was used.',
    next: 'Print the number used for the length.',
  },
  jsInvalidJson: {
    what: 'The text is not valid JSON.',
    cause:
      'JSON needs double quotes and no trailing commas. A text that starts with an angle bracket ' +
      'is usually a web page, not JSON.',
    next: 'Print the text before parsing it. Check quotes, commas, and brackets.',
  },
  jsAlreadyDeclared: {
    what: 'The name {name} is declared twice.',
    cause: 'let and const cannot repeat a name in the same scope.',
    next: 'Rename one of them, or remove the second let or const and just assign.',
  },
  jsMissingInitializer: {
    what: 'A const needs a value where it is declared.',
    cause: 'const cannot be set later.',
    next: 'Give it a value on the same line, or use let.',
  },
  jsUnexpectedEnd: {
    what: 'The code ends too early.',
    cause: 'A bracket, brace, or quote is still open at the end of the file.',
    next: 'Check that every opening bracket has its partner.',
  },
  jsUnexpectedIdentifier: {
    what: 'A name appears where the code does not expect one.',
    cause: 'A comma, an operator, or a semicolon is probably missing just before it.',
    next: 'Look at the line and the one before it.',
  },
  jsUnexpectedToken: {
    what: 'The symbol {token} is not expected here.',
    cause: 'A symbol that does not fit the grammar. An extra or missing bracket, comma, or quote is usual.',
    next: 'Check the line and the line before it. Match every bracket and brace.',
  },
  jsInvalidToken: {
    what: 'A character or string is not valid.',
    cause:
      'An unclosed quote or a character that JavaScript does not allow, such as a curly quote ' +
      'pasted from a document.',
    next: 'Close the quote. Replace curly quotes with straight ones.',
  },
  jsAwaitOutside: {
    what: 'await is used outside an async function.',
    cause: 'await only works in a function declared with async, or at the top of a module.',
    next: 'Add async before the function.',
  },
  jsClassTypeError: {
    what: 'A value is the wrong type for this operation.',
    cause: 'The code used a value in a way its type does not allow.',
    next: 'Read the message and print the value.',
  },
  jsClassRangeError: {
    what: 'A number is outside the allowed range.',
    cause: 'A value is too big, too small, or negative where that is not allowed.',
    next: 'Check the number used.',
  },
  jsClassSyntaxError: {
    what: 'The code breaks a grammar rule.',
    cause: 'A bracket, comma, quote, or keyword is missing or extra.',
    next: 'Check this line and the one above it.',
  },
  jsClassReferenceError: {
    what: 'A name is used that does not exist.',
    cause: 'The name is misspelled or was never declared.',
    next: 'Check the spelling and the order of the lines.',
  },
  jsClassUriError: {
    what: 'A web address could not be decoded.',
    cause: 'decodeURI or encodeURI got text with a broken percent sequence.',
    next: 'Check the text for stray percent signs.',
  },
  jsClassError: {
    what: 'The program stopped with an error.',
    cause: 'The program threw an error with this message.',
    next: 'Read the message, then check the line shown.',
  },
} as const;
