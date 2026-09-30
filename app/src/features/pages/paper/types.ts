// Types for paper backgrounds (format spec 5.4). Paper is drawn as vector paths in page units, sheet by sheet, so the
// screen and the PDF export draw the same lines.

import type { Rect } from '../pagination/geometry';

/** The patterns the format defines. A page from another writer may hold a value not listed here, drawn as plain. */
export type PatternName = 'plain' | 'ruled' | 'grid' | 'dots' | 'isometric' | 'cornell' | 'staff' | 'template';

/** How heavy a line is: a hairline or a divider (1 and 1.5 page units). */
export type Weight = 'rule' | 'strong';

export interface PageBackground {
  readonly pattern: PatternName | (string & {});
  /** Line or grid spacing in page units. Default 26.46. */
  readonly spacing?: number;
  /** `rule` for the theme's rule color, a palette name, or a hexadecimal color. */
  readonly color?: string;
  /** Draws a margin line on ruled paper. */
  readonly marginLine?: boolean;
  /** The drawing for the `template` pattern, stored in the page so the page is complete on its own. */
  readonly template?: PaperTemplate;
}

/** An element's position and size, as fractions of the template's area from 0 to 1. */
export type TemplateElement =
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly weight?: Weight;
    }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly weight?: Weight;
      readonly fill?: 'none' | 'tint';
    }
  | {
      readonly kind: 'rules' | 'grid' | 'dots' | 'staff';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      /** In page units, not a fraction. */
      readonly spacing: number;
    }
  | {
      readonly kind: 'label';
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly size?: 'caption' | 'small';
    };

export interface PaperTemplate {
  readonly id: string;
  readonly title: string;
  /** `content` is the content box inside the margins, and `sheet` is the whole sheet. */
  readonly area: 'content' | 'sheet';
  readonly elements: readonly TemplateElement[];
}

/** Text that the screen and the export draw with the interface font. `x` and `y` are the baseline's start. */
export interface PaperLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: 'caption' | 'small';
}

/** Everything one sheet of paper draws, as SVG path data. Each path is drawn in its own color and weight. */
export interface PaperPaths {
  /** Hairlines, 1 page unit wide. */
  readonly rules: string;
  /** Dividers and template rectangles, 1.5 page units wide. */
  readonly strong: string;
  /** Zero-length subpaths, drawn with round caps 1.5 page units wide. */
  readonly dots: string;
  /** The margin line of ruled paper. */
  readonly margin: string;
  readonly tints: readonly Rect[];
  readonly labels: readonly PaperLabel[];
}

/** The widths the renderers use, in page units. */
export const STROKE = { rule: 1, strong: 1.5 } as const;
