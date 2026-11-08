// The conditional layer the model and the render lane call (rules.ts hooks). The model hands over the rules that
// cover a cell in the order they apply. The layer gives the styles of the rules that match, lowest priority first
// so the rule at order 1 wins a clash, and stops at a matching rule with `stop` (R-SHT-15). Data bars and icons are
// drawn as CSS custom properties and data attributes beside the style.

import {
  setConditionalLayer,
  setDrawnLayer,
  getLayerScheme,
  rulesAt,
  type ConditionalLayer,
  type DrawnDecoration,
  type DrawnLayer,
  type Rule,
} from '../model/rules';
import { styleById } from '../model/styles';
import type { CellStyle, Sheet, TableLike } from '../model/types';
import { own } from '../model/json';
import { ruleMatches, type RuleContext } from './match';
import { barOf, iconOf, scaleColor, type Bar } from './visual';

/** The types that draw instead of giving a style. */
const DRAWN = new Set(['scale', 'bar', 'icons']);

export const conditionalLayer: ConditionalLayer = (rules, cell, sheet, table) => {
  const found: CellStyle[] = [];
  if (table.header === true && cell.row === 0) return found;
  const scheme = getLayerScheme();
  for (const rule of rules) {
    const type = own(rule.rule, 'type');
    const c: RuleContext = { sheet, table, rule, row: cell.row, col: cell.col };
    let style: CellStyle | undefined;
    if (type === 'scale') {
      const fill = scaleColor(c, scheme);
      if (fill === undefined) continue;
      style = { fill };
    } else if (typeof type === 'string' && !DRAWN.has(type)) {
      if (!ruleMatches(c)) continue;
      const id = own(rule.rule, 'style');
      style = (typeof id === 'string' ? styleById(sheet, id) : undefined) ?? {};
    } else if (DRAWN.has(String(type))) {
      // A bar or an icon set draws; it matches a cell that holds a number.
      const shown = type === 'bar' ? barOf(c, scheme) : iconOf(c, scheme);
      if (!shown) continue;
    } else continue;
    if (style && Object.keys(style).length > 0) found.push(style);
    if (rule.rule.stop === true) break;
  }
  // The rules came in priority order, highest first; the model wants the lowest first.
  return found.reverse();
};

/** CSS for a bar: a gradient that is clear outside the bar, with an optional border drawn on its four edges. */
export function barCss(bar: Bar): string {
  const from = bar.left;
  const to = bar.left + bar.width;
  const toward = bar.side === 'right' ? 'to right' : 'to left';
  const a = bar.side === 'right' ? from : 100 - to;
  const b = bar.side === 'right' ? to : 100 - from;
  const fade = `color-mix(in srgb, ${bar.color} 30%, transparent)`;
  const inner = bar.gradient ? `${bar.color} ${a}%, ${fade} ${b}%` : `${bar.color} ${a}% ${b}%`;
  const fill = `linear-gradient(${toward}, transparent 0 ${a}%, ${inner}, transparent ${b}% 100%)`;
  if (!bar.border || bar.width <= 0) return fill;
  // A one pixel line along the top, bottom, left, and right edges of the bar.
  const line = (size: string, at: string) => `linear-gradient(${bar.border}, ${bar.border}) ${at} / ${size} no-repeat`;
  const pos = (x: number) => `${bar.width >= 100 ? 0 : (x / (100 - bar.width)) * 100}%`;
  return [
    line(`${bar.width}% 1px`, `${pos(from)} 0`),
    line(`${bar.width}% 1px`, `${pos(from)} 100%`),
    line(`1px 100%`, `${pos(from)} 0`),
    line(`1px 100%`, `${pos(to)} 0`),
    fill,
  ].join(', ');
}

/** A CSS string in single quotes, so it sits inside a style attribute written with double quotes. */
function cssString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export const drawnLayer: DrawnLayer = (cell, sheet: Sheet, table: TableLike, scheme) => {
  const out: DrawnDecoration = { vars: {}, data: {} };
  if (table.header === true && cell.row === 0) return undefined;
  const rules = rulesFor(sheet, table, cell);
  let any = false;
  for (const rule of rules) {
    const type = own(rule.rule, 'type');
    const c: RuleContext = { sheet, table, rule, row: cell.row, col: cell.col };
    if (type === 'bar' && out.vars['--cell-bar'] === undefined) {
      const bar = barOf(c, scheme);
      if (bar) {
        out.vars['--cell-bar'] = barCss(bar);
        out.data['data-bar'] = bar.side;
        if (bar.barOnly) out.data['data-bar-only'] = '';
        any = true;
      }
    } else if (type === 'icons' && out.data['data-icon-glyph'] === undefined) {
      const icon = iconOf(c, scheme);
      if (icon) {
        out.data['data-icon-glyph'] = icon.glyph;
        out.data['data-icon-text'] = icon.text;
        out.data['data-icon-index'] = String(icon.index);
        // The stylesheet reads these as quoted strings: the glyph, then its text as the alternative for screen readers.
        out.vars['--cell-icon-glyph'] = cssString(icon.glyph);
        out.vars['--cell-icon-text'] = cssString(icon.text);
        if (icon.color) out.vars['--cell-icon-color'] = icon.color;
        if (icon.iconOnly) out.data['data-icon-only'] = '';
        any = true;
      }
    }
    if (rule.rule.stop === true && any) break;
  }
  return any ? out : undefined;
};

function rulesFor(sheet: Sheet, table: TableLike, cell: { row: number; col: number }): Rule[] {
  return rulesAt(sheet, table, 'conditional', cell.row, cell.col);
}

/** Connects the conditional formats to the model and the render lane. Safe to call again. */
export function installConditional(): void {
  setConditionalLayer(conditionalLayer);
  setDrawnLayer(drawnLayer);
}
