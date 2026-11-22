// Quick fixes without a model (DESIGN 7.1, lane code:L11). `fixesFor` gives the fixes for one diagnostic.
// `attachFixes` puts them on a file's diagnostics, so the editor shows them in the hover menu and the lightbulb.
// `fixAll` joins every fix of one kind into a single edit (R2).

import type { Diagnostic, Fix, TextEdit } from '../contracts';
import { FIX_KINDS, RULES, type FixKind, type KindedFix } from './rules';
import type { FixContext } from './source';

export { distance, limit, suggestions } from './distance';
export { FIX_KINDS, sqlSchema } from './rules';
export type { FixKind, KindedFix } from './rules';
export type { FixContext } from './source';

/** The fixes one diagnostic offers, best first. A rule that cannot read the diagnostic offers nothing. */
export function fixesFor(diagnostic: Diagnostic, ctx: FixContext): KindedFix[] {
  const found: KindedFix[] = [];
  for (const rule of RULES) {
    try {
      found.push(...rule(diagnostic, ctx));
    } catch {
      // A fix is a convenience: a rule that fails on odd text must not hide the problem.
    }
  }
  return found.filter((f) => f.edits.every((e) => e.from >= 0 && e.to >= e.from && e.to <= ctx.text.length));
}

/** The diagnostics with their fixes added. Diagnostics that already carry fixes keep them. */
export function attachFixes(items: readonly Diagnostic[], ctx: FixContext): Diagnostic[] {
  return items.map((item) => {
    if (item.fixes?.length) return item;
    const fixes = fixesFor(item, ctx);
    return fixes.length ? { ...item, fixes } : item;
  });
}

/** Applies edits to text. Edits must not overlap. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from || b.to - a.to))
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

const overlaps = (a: TextEdit, b: TextEdit): boolean => a.from < b.to && b.from < a.to;
const sameSpot = (a: TextEdit, b: TextEdit): boolean => a.from === b.from && a.to === b.to;

/**
 * One fix that does the preferred fix of every diagnostic of `kind`, or null when there are fewer than two. A fix that
 * would overlap one already taken is left for the next round, so the result is always safe to apply.
 */
export function fixAll(diagnostics: readonly Diagnostic[], ctx: FixContext, kind: FixKind): Fix | null {
  const taken: TextEdit[] = [];
  let count = 0;
  let title = '';
  for (const d of diagnostics) {
    const best = fixesFor(d, ctx).find((f) => f.kind === kind);
    if (!best) continue;
    if (best.edits.some((e) => taken.some((t) => overlaps(e, t) || sameSpot(e, t)))) continue;
    taken.push(...best.edits);
    title = best.title;
    count += 1;
  }
  return count < 2 ? null : { title: `${title} (${count})`, edits: taken };
}

/** The kinds of fix the diagnostics offer, with how many of each, for the "Fix all" menu entries. */
export function fixKindsIn(diagnostics: readonly Diagnostic[], ctx: FixContext): Map<FixKind, number> {
  const counts = new Map<FixKind, number>();
  for (const d of diagnostics) {
    const first = fixesFor(d, ctx)[0];
    if (first) counts.set(first.kind, (counts.get(first.kind) ?? 0) + 1);
  }
  return new Map(FIX_KINDS.filter((k) => counts.has(k)).map((k) => [k, counts.get(k)!]));
}
