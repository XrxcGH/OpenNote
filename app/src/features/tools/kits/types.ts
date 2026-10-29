// What a kit tool is made of, shared by every kit. Engines return these plain values (no React, no t()), and the
// kit UI turns them into words, tables, plots, and page inserts.
import type { ComponentType, LazyExoticComponent } from 'react';
import type { UnitSystem } from './units';

/** One worked step. `key` is a full message key (such as "kitThermo.cycle.step.heat"), filled in with `vars`. */
export interface KitStep {
  key: string;
  vars?: Readonly<Record<string, string | number>>;
  /** The step's equation or substitution in LaTeX. The engine builds it from numbers; typed text never goes in. */
  math?: string;
}

/** One line of a results table: a label already in words, the value as text, and its unit label. */
export interface KitResultRow {
  id: string;
  label: string;
  value: string;
  unit: string;
  /** The answer the tool was asked for. The table shows it first, in bold. */
  answer?: boolean;
}

/** What the Insert menu hands the page. Each part is optional; the menu offers only what a tool has. */
export interface KitInsertContent {
  /** A one-line answer, such as "p = 101.3 kPa". */
  answer?: string;
  /** The key result as a LaTeX equation. */
  latex?: string;
  rows?: readonly KitResultRow[];
  steps?: readonly KitStep[];
  /** The plot or diagram as SVG text, with its alternative text. */
  picture?: { svg: string; alt: string };
  /** A short summary for the live calculation block and its search text, such as "Ideal gas: p = 101.3 kPa". */
  summary?: string;
}

/** What a kit window gives each of its tools. */
export interface KitToolProps {
  /** The inputs saved for this tab, or restored from a live calculation block; null on first use. */
  inputs: unknown;
  /** Saves the tool's inputs, so the tab and a live calculation block can restore them. */
  setInputs(next: unknown): void;
  system: UnitSystem;
}

export interface KitToolDef {
  id: string;
  /** Message keys in the kit's namespace. */
  title: string;
  keywords: string;
  /** A Phosphor icon name for the palette. */
  icon: string;
  Component: LazyExoticComponent<ComponentType<KitToolProps>> | ComponentType<KitToolProps>;
}

export interface KitDef {
  id: string;
  /** The kit window's title key, such as "kitThermo.title". */
  title: string;
  tools: readonly KitToolDef[];
}
