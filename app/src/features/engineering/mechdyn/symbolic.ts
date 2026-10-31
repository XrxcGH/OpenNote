// The symbolic algebra the dynamics tools differentiate and print typed formulas with. It belongs to the math
// feature and loads with the tools that need it, so the engines stay synchronous once their tab is open.
import type { Node } from '../../../core/expr';

export interface Symbolic {
  derivativeOf(node: Node, x: string, order?: number): Node;
  latexOf(node: Node): string;
  simplest(node: Node): Node;
  substitute(node: Node, variable: string, value: Node): Node;
}

let loaded: Symbolic | null = null;

/** Hands the engines the algebra; tests call this with the math feature's own modules. */
export function provideSymbolic(algebra: Symbolic): void {
  loaded = algebra;
}

/** Loads the algebra once, before a tool that needs it runs. */
export async function loadSymbolic(): Promise<Symbolic> {
  if (!loaded) provideSymbolic(await (await import('../../math')).loadSymbolic());
  return loaded as unknown as Symbolic;
}

/** The algebra, which a tool's loader has already fetched. */
export function symbolic(): Symbolic {
  if (!loaded) throw new Error('The symbolic algebra has not loaded.');
  return loaded;
}
