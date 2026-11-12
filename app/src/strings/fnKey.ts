// The string key of a spreadsheet function. A dot in a name (ERROR.TYPE, STDEV.S) would split a dotted message key,
// so the fn* description files store it with a low line (ERROR_TYPE).

/** The key a function's description is stored under in the fn* string files. */
export function fnKey(name: string): string {
  return name.replace(/\./g, '_');
}
