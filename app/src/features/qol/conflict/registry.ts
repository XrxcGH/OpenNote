// The conflict view registry (ADR 0089). A block type registers its own compare and resolve view, and the
// conflict dialog shows it for each changed block of that type. Every other block keeps the side-by-side text.
// Tables (table merge on sync) and code projects (the code project conflict view) register theirs.

import type { ComponentType } from 'react';

/** How a conflict is resolved: this version, the other one, or both as separate pages. */
export type ConflictChoice = 'keepMine' | 'keepTheirs' | 'keepBoth';

/** One block that differs between the two versions, as the core writes it in `page.json`. */
export interface ConflictBlock {
  readonly id: string;
  readonly type: string;
  /** The block on this device, or `null` if this version has no such block. */
  readonly mine: unknown;
  /** The block in the other version, or `null` if that version has no such block. */
  readonly theirs: unknown;
}

export interface ConflictViewProps {
  readonly block: ConflictBlock;
  /** The other device's label, or a generic name. */
  readonly otherDevice: string;
  /** Resolves the whole conflict, as the dialog's own buttons do. */
  resolve(choice: ConflictChoice): void;
}

export type ConflictView = ComponentType<ConflictViewProps>;

const views = new Map<string, ConflictView>();

/** Registers the compare and resolve view for a block type. Returns a function that removes it again. */
export function registerConflictView(type: string, view: ConflictView): () => void {
  views.set(type, view);
  return () => {
    if (views.get(type) === view) views.delete(type);
  };
}

/** The view registered for a block type, if any. */
export function conflictViewFor(type: string): ConflictView | undefined {
  return views.get(type);
}

/** Splits changed blocks into those with a registered view and the rest, which the text view shows. */
export function splitByView(blocks: readonly ConflictBlock[] | undefined): {
  readonly registered: ReadonlyArray<{ block: ConflictBlock; View: ConflictView }>;
  readonly others: readonly ConflictBlock[];
} {
  const registered: Array<{ block: ConflictBlock; View: ConflictView }> = [];
  const others: ConflictBlock[] = [];
  for (const block of blocks ?? []) {
    const View = views.get(block.type);
    if (View) registered.push({ block, View });
    else others.push(block);
  }
  return { registered, others };
}
