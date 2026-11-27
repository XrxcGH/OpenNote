// What NVDA must say for the code editor and the Code studio, as case-insensitive patterns. No Playwright and no NVDA
// code, so a plain Node test can check them against the app's strings (codeStudioPhrases.test.ts).

/** What NVDA must say for a suggestion and for what was inserted, in order. */
export const CODE_EDITOR_PHRASES: readonly RegExp[] = [
  /Suggestion: nt\(total\)\. Ctrl\+Tab to accept\./i,
  /Inserted: nt\(total\)/i,
];

/**
 * What NVDA must say for a squiggle: the line, then the message (strings codeStudio.editor.say.problem). NVDA's
 * speech leaves out the quote before a word, so it says "Undefined name totl'" for "Undefined name 'totl'".
 */
export const SQUIGGLE_PHRASES: readonly RegExp[] = [/Line 1: Undefined name '?totl/i];

/** What NVDA must say when a run pauses on a line, once the debugger screen exists (R3). */
export const DEBUGGER_PHRASES: readonly RegExp[] = [/Paused at line \d+/i];

/** What NVDA must say for the console's error link (strings codeStudio.studio.openAt). */
export const CONSOLE_PHRASES: readonly RegExp[] = [/Open main\.py at line 3/i];

/** What NVDA must say for a row of the Problems panel: the severity, the message, and the place. */
export const PROBLEMS_PHRASES: readonly RegExp[] = [/Error/i, /boom/i, /Line 3, column 1/i];
