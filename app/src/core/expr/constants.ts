// Constants every host shares. A host adds its own, such as physical constants or the names of table cells.

export const MATH_CONSTANTS: Readonly<Record<string, number>> = Object.freeze({
  pi: Math.PI,
  tau: 2 * Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
});

/** The value of a constant by name, or undefined. Names such as "constructor" are not constants. */
export function mathConstant(name: string): number | undefined {
  return Object.hasOwn(MATH_CONSTANTS, name) ? MATH_CONSTANTS[name] : undefined;
}
