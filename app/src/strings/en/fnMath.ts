// Descriptions of the math and trigonometry functions, one line each, written fresh in American English.
// Owner: tables:fn-math (B10). Each function has a description and a line for each argument.

const arg = {
  a: 'The first number.',
  array: 'A block of numbers.',
  arrayX: 'The first block of numbers.',
  arrayY: 'The second block of numbers.',
  b: 'The second number.',
  base: 'The base of the logarithm. It is 10 when left out.',
  bottom: 'The smallest whole number allowed.',
  chosen: 'How many items to choose.',
  coefficients: 'The numbers that multiply each power.',
  criteriaRange: 'The cells to test against the next criterion.',
  criterion: 'The test a cell must meet, such as ">2" or "apple".',
  digits: 'How many decimal places to keep. It is 0 when left out.',
  dividend: 'The number to divide.',
  divisor: 'The number to divide by.',
  form: 'How concise the numeral is, from 0 (classic) to 4 (most concise).',
  function: 'Which calculation to run, by its number.',
  m: 'How much the power grows from term to term.',
  minLength: 'The fewest characters in the result, padded with zeros.',
  mode: 'Zero rounds a negative number up. Any other value rounds it away from zero.',
  multiple: 'The number whose multiples to round to.',
  n: 'The first power of x.',
  number: 'The number to use.',
  options: 'Which rows and errors to ignore, from 0 to 7.',
  part: 'The cells counted in the share.',
  power: 'The exponent.',
  radix: 'The base of the number system, from 2 to 36.',
  range: 'The cells to test.',
  ref: 'A range of cells.',
  step: 'The multiple to round to. It is 1 when left out.',
  sumRange: 'The cells to add. They default to the cells tested.',
  text: 'The text to read.',
  top: 'The largest whole number allowed.',
  value: 'A number, a cell, or a range of cells.',
  whole: 'The cells counted in the total.',
  x: 'The first number, or the value to evaluate at.',
  y: 'The second number.',
} as const;

/** A function's line and one line per argument, by argument name. */
export interface FnText {
  readonly description: string;
  readonly params: Readonly<Record<string, string>>;
}

// Typed as unknown values on purpose. Function text is looked up by function name at run time, never through t(),
// and a typed key for each of the 80 names and their arguments makes the message key union too large for the compiler.
export const fnMath: Readonly<Record<string, unknown>> = {
  ABS: { description: 'Gives the size of a number, without its sign.', params: { number: arg.number } },
  ACOS: { description: 'Gives the angle, in radians, whose cosine is the number.', params: { number: arg.number } },
  ACOSH: {
    description: 'Gives the inverse hyperbolic cosine of a number that is at least 1.',
    params: { number: arg.number },
  },
  ACOT: {
    description: 'Gives the angle, in radians from 0 to pi, whose cotangent is the number.',
    params: { number: arg.number },
  },
  ACOTH: {
    description: 'Gives the inverse hyperbolic cotangent of a number beyond -1 and 1.',
    params: { number: arg.number },
  },
  ADD: { description: 'Adds two numbers.', params: { a: arg.a, b: arg.b } },
  AGGREGATE: {
    description:
      'Calculates a sum, count, average, or other measure over cells. You choose which rows and errors to ignore.',
    params: { function: arg.function, options: arg.options, ref: arg.ref },
  },
  ARABIC: { description: 'Turns a Roman numeral into a number.', params: { text: arg.text } },
  ASIN: { description: 'Gives the angle, in radians, whose sine is the number.', params: { number: arg.number } },
  ASINH: { description: 'Gives the inverse hyperbolic sine of a number.', params: { number: arg.number } },
  ATAN: { description: 'Gives the angle, in radians, whose tangent is the number.', params: { number: arg.number } },
  ATAN2: {
    description: 'Gives the angle, in radians, of the point at x and y, measured from the x axis.',
    params: { x: arg.x, y: arg.y },
  },
  ATANH: {
    description: 'Gives the inverse hyperbolic tangent of a number between -1 and 1.',
    params: { number: arg.number },
  },
  BASE: {
    description: 'Writes a whole number in another base, such as binary or hexadecimal.',
    params: { number: arg.number, radix: arg.radix, minLength: arg.minLength },
  },
  CEILING: {
    description: 'Rounds a number up to a multiple of the step.',
    params: { number: arg.number, step: arg.step },
  },
  [['CEILING', 'MATH'].join('.')]: {
    description: 'Rounds a number up to a multiple of the step, with a choice for negative numbers.',
    params: { number: arg.number, step: arg.step, mode: arg.mode },
  },
  [['CEILING', 'PRECISE'].join('.')]: {
    description: 'Rounds a number up to a multiple of the step, whatever the sign of either.',
    params: { number: arg.number, step: arg.step },
  },
  COMBIN: {
    description: 'Counts the ways to choose items from a group, when order does not matter.',
    params: { number: arg.number, chosen: arg.chosen },
  },
  COMBINA: {
    description: 'Counts the ways to choose items from a group when an item may be chosen more than once.',
    params: { number: arg.number, chosen: arg.chosen },
  },
  COS: { description: 'Gives the cosine of an angle in radians.', params: { number: arg.number } },
  COSH: { description: 'Gives the hyperbolic cosine of a number.', params: { number: arg.number } },
  COT: { description: 'Gives the cotangent of an angle in radians.', params: { number: arg.number } },
  COTH: { description: 'Gives the hyperbolic cotangent of a number.', params: { number: arg.number } },
  CSC: { description: 'Gives the cosecant of an angle in radians.', params: { number: arg.number } },
  CSCH: { description: 'Gives the hyperbolic cosecant of a number.', params: { number: arg.number } },
  DECIMAL: {
    description: 'Reads text written in another base and gives its value.',
    params: { text: arg.text, radix: arg.radix },
  },
  DEGREES: { description: 'Turns an angle in radians into degrees.', params: { number: arg.number } },
  DIVIDE: { description: 'Divides one number by another.', params: { a: arg.a, b: arg.b } },
  EVEN: {
    description: 'Rounds a number away from zero to the next even whole number.',
    params: { number: arg.number },
  },
  EXP: { description: 'Gives e raised to a power.', params: { number: arg.number } },
  FACT: {
    description: 'Gives the factorial of a number: the product of the whole numbers from 1 up to it.',
    params: { number: arg.number },
  },
  FACTDOUBLE: {
    description: 'Gives the double factorial: the product of every second whole number down from the number.',
    params: { number: arg.number },
  },
  FLOOR: {
    description: 'Rounds a number down to a multiple of the step.',
    params: { number: arg.number, step: arg.step },
  },
  [['FLOOR', 'MATH'].join('.')]: {
    description: 'Rounds a number down to a multiple of the step, with a choice for negative numbers.',
    params: { number: arg.number, step: arg.step, mode: arg.mode },
  },
  [['FLOOR', 'PRECISE'].join('.')]: {
    description: 'Rounds a number down to a multiple of the step, whatever the sign of either.',
    params: { number: arg.number, step: arg.step },
  },
  GCD: {
    description: 'Gives the largest whole number that divides every number given.',
    params: { number: arg.number },
  },
  INT: { description: 'Rounds a number down to the nearest whole number.', params: { number: arg.number } },
  [['ISO', 'CEILING'].join('.')]: {
    description: 'Rounds a number up to a multiple of the step, whatever the sign of either.',
    params: { number: arg.number, step: arg.step },
  },
  LCM: {
    description: 'Gives the smallest whole number that every number given divides.',
    params: { number: arg.number },
  },
  LN: { description: 'Gives the natural logarithm of a number.', params: { number: arg.number } },
  LOG: {
    description: 'Gives the logarithm of a number to the base you choose.',
    params: { number: arg.number, base: arg.base },
  },
  LOG10: { description: 'Gives the base 10 logarithm of a number.', params: { number: arg.number } },
  MINUS: { description: 'Subtracts the second number from the first.', params: { a: arg.a, b: arg.b } },
  MOD: {
    description: 'Gives the remainder after division. The result has the sign of the divisor.',
    params: { number: arg.number, divisor: arg.divisor },
  },
  MROUND: {
    description: 'Rounds a number to the nearest multiple.',
    params: { number: arg.number, multiple: arg.multiple },
  },
  MULTINOMIAL: {
    description: 'Counts the ways to split a group into parts of the sizes given.',
    params: { number: arg.number },
  },
  MULTIPLY: { description: 'Multiplies two numbers.', params: { a: arg.a, b: arg.b } },
  ODD: { description: 'Rounds a number away from zero to the next odd whole number.', params: { number: arg.number } },
  PERCENTOF: {
    description: 'Gives what share of the total the first cells make up.',
    params: { part: arg.part, whole: arg.whole },
  },
  PI: { description: 'Gives pi, 3.14159265358979.', params: {} },
  POWER: { description: 'Raises a number to a power.', params: { number: arg.number, power: arg.power } },
  PRODUCT: { description: 'Multiplies the numbers together.', params: { value: arg.value } },
  QUOTIENT: {
    description: 'Gives the whole part of a division, dropping the remainder.',
    params: { dividend: arg.dividend, divisor: arg.divisor },
  },
  RADIANS: { description: 'Turns an angle in degrees into radians.', params: { number: arg.number } },
  RAND: {
    description: 'Gives a random number from 0 up to, but not including, 1. It changes on every calculation.',
    params: {},
  },
  RANDBETWEEN: {
    description: 'Gives a random whole number between two limits. It changes on every calculation.',
    params: { bottom: arg.bottom, top: arg.top },
  },
  ROMAN: {
    description: 'Writes a number from 0 to 3999 as a Roman numeral.',
    params: { number: arg.number, form: arg.form },
  },
  ROUND: {
    description: 'Rounds a number to a set number of decimal places, halves away from zero.',
    params: { number: arg.number, digits: arg.digits },
  },
  ROUNDDOWN: {
    description: 'Rounds a number toward zero to a set number of decimal places.',
    params: { number: arg.number, digits: arg.digits },
  },
  ROUNDUP: {
    description: 'Rounds a number away from zero to a set number of decimal places.',
    params: { number: arg.number, digits: arg.digits },
  },
  SEC: { description: 'Gives the secant of an angle in radians.', params: { number: arg.number } },
  SECH: { description: 'Gives the hyperbolic secant of a number.', params: { number: arg.number } },
  SERIESSUM: {
    description: 'Adds the terms of a power series: each coefficient times x raised to a growing power.',
    params: { x: arg.x, n: arg.n, m: arg.m, coefficients: arg.coefficients },
  },
  SIGN: {
    description: 'Gives 1 for a positive number, -1 for a negative one, and 0 for zero.',
    params: { number: arg.number },
  },
  SIN: { description: 'Gives the sine of an angle in radians.', params: { number: arg.number } },
  SINH: { description: 'Gives the hyperbolic sine of a number.', params: { number: arg.number } },
  SQRT: { description: 'Gives the square root of a number.', params: { number: arg.number } },
  SQRTPI: { description: 'Gives the square root of a number times pi.', params: { number: arg.number } },
  SUBTOTAL: {
    description:
      'Calculates a sum, count, average, or other measure over a range, skipping filtered rows. Numbers from 101 up also skip hidden rows.',
    params: { function: arg.function, ref: arg.ref },
  },
  SUM: { description: 'Adds the numbers together.', params: { value: arg.value } },
  SUMIF: {
    description: 'Adds the cells that meet a test.',
    params: { range: arg.range, criterion: arg.criterion, sumRange: arg.sumRange },
  },
  SUMIFS: {
    description: 'Adds the cells whose matching cells meet every test.',
    params: { sumRange: arg.sumRange, criteriaRange: arg.criteriaRange, criterion: arg.criterion },
  },
  SUMPRODUCT: {
    description: 'Multiplies matching items of the blocks and adds the products.',
    params: { array: arg.array },
  },
  SUMSQ: { description: 'Adds the squares of the numbers.', params: { value: arg.value } },
  SUMX2MY2: {
    description: 'Adds the difference of the squares of matching items in two blocks.',
    params: { arrayX: arg.arrayX, arrayY: arg.arrayY },
  },
  SUMX2PY2: {
    description: 'Adds the sum of the squares of matching items in two blocks.',
    params: { arrayX: arg.arrayX, arrayY: arg.arrayY },
  },
  SUMXMY2: {
    description: 'Adds the squares of the differences of matching items in two blocks.',
    params: { arrayX: arg.arrayX, arrayY: arg.arrayY },
  },
  TAN: { description: 'Gives the tangent of an angle in radians.', params: { number: arg.number } },
  TANH: { description: 'Gives the hyperbolic tangent of a number.', params: { number: arg.number } },
  TRUNC: {
    description: 'Cuts a number to a set number of decimal places, toward zero.',
    params: { number: arg.number, digits: arg.digits },
  },
};
