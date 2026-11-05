// The CSS declarations for a run's version 2 formatting. Owner: text:rendering-css (B10). text:scaffold wrote the
// typed stub, so the render path can call it now; it returns no declarations until the owner fills it in.

/** Inline style declarations, as property to value. */
export type StyleDeclarations = Readonly<Record<string, string>>;

/** The declarations for one run's formatting attributes. */
export function runStyle(_attrs: Readonly<Record<string, unknown>>): StyleDeclarations {
  return {};
}
