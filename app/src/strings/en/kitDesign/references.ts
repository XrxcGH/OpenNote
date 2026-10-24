// checks-disable-file length: messages are full sentences kept on one line

// The words of the design kit's programming references tool. The reference cards themselves are in
// features/tools/design/referenceData.ts, written for OpenNote.
export const references = {
  title: 'Programming references',
  keywords:
    'programming reference c++ types escape sequences operator precedence common errors compile error runtime matlab cheat sheet trace table coding',
  about:
    'Quick references for learning to program: how C++ types and escape sequences work, what common errors mean, MATLAB habits, which operator binds first, and a blank trace table to fill in as you read code by hand.',
  cards: 'Reference cards',
  search: 'Search the cards',
  group: 'Show',
  groups: {
    all: 'All cards',
    types: 'C++ types',
    escapes: 'Escape sequences',
    errors: 'Common errors',
    matlab: 'MATLAB',
  },
  none: 'No card matches. Try fewer or different words.',
  count: '{count, plural, one {# card} other {# cards}}',
  precedence: 'Operator precedence in C++',
  precedenceAbout:
    'Choose two binary operators to see which one binds tighter in an expression such as x op y op z. The table lists every operator, from the tightest to the loosest.',
  firstOperator: 'First operator',
  secondOperator: 'Second operator',
  unlisted: 'One of those operators is not in the table.',
  verdict: {
    first: 'In x {first} y {second} z, the {first} binds tighter, so it is worked out first.',
    second: 'In x {first} y {second} z, the {second} binds tighter, so it is worked out first.',
    tie: 'In x {first} y {second} z, the two bind equally tightly, so they group {order}.',
  },
  order: { left: 'from left to right', right: 'from right to left' },
  rank: 'Rank',
  operators: 'Operators',
  assocColumn: 'Groups',
  meaning: 'What they do',
  assoc: { left: 'Left to right', right: 'Right to left', none: 'Not chained' },
  trace: 'Trace table',
  traceAbout:
    'A trace table follows the values of the variables line by line while you run a program in your head. Name the variables, choose the number of rows, then fill it in on the page.',
  variables: 'Variables to follow, separated by spaces, or commas',
  traceRows: 'Number of rows (1 to 60)',
  rowsRange: 'Use a whole number of rows from 1 to 60.',
  line: 'Line',
  output: 'Output',
  insertTable: 'Insert the blank table',
};
