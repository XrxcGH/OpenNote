// The stylesheet that turns the print document into one PDF page for each sheet (ADR 0006): an `@page` rule with the
// sheet's size and no margins, sheets as fixed boxes that break after themselves, and everything positioned inside a
// sheet. There is no desk, gap, or shadow, and nothing depends on the screen's pixel density.

import { tokens } from '../../../theme/tokens';
import type { PaperStyle } from '../paper/svg';
import type { DocTheme } from '../export/style';
import type { PrintPlan } from './sheets';

const px = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The paper generators' token names, and the custom properties that carry the light values for them. */
export function paperStyle(theme: DocTheme): { style: PaperStyle; vars: string } {
  const c = tokens.color.light;
  const pens = Object.keys(theme.pens);
  const style: PaperStyle = {
    tokens: {
      rule: 'border.subtle',
      strong: 'border.control',
      margin: 'accent.clay',
      label: 'text.muted',
      tint: 'surface.sunken',
    },
    palette: Object.fromEntries(pens.map((name) => [name, `pen.${name}`])),
    fontToken: 'font.ui',
    labelSizes: { caption: 9, small: 11 },
  };
  const vars = [
    `--color-border-subtle:${c.border.subtle}`,
    `--color-border-control:${c.border.control}`,
    `--color-accent-clay:${c.accent.clay}`,
    `--color-text-muted:${c.text.muted}`,
    `--color-surface-sunken:${c.surface.sunken}`,
    `--font-ui:${theme.fonts.ui}`,
    ...pens.map((name) => `--color-pen-${name}:${theme.pens[name]}`),
  ].join(';');
  return { style, vars: `:root{${vars}}` };
}

/** The rules for the sheets. Add the document styles (`documentCss`) before it. */
export function printCss(plan: PrintPlan, theme: DocTheme): string {
  const { width: w, height: h } = plan.box;
  return [
    paperStyle(theme).vars,
    `@page{size:${px(w)}px ${px(h)}px;margin:0}`,
    `html,body{margin:0;padding:0;background:none}`,
    `body{-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    `.sheet{position:relative;width:${px(w)}px;height:${px(h)}px;overflow:hidden;break-after:page;` +
      `page-break-after:always;break-inside:avoid}`,
    `.sheet:last-child{break-after:auto;page-break-after:auto}`,
    `.paper,.ink-under,.ink-over{position:absolute;left:0;top:0;pointer-events:none}`,
    `.paper svg,.ink-under svg,.ink-over svg{display:block;max-width:none}`,
    `.unit,.slice,.float{display:flow-root}`,
    `.slice,.float{position:absolute}`,
    `.slice.cont>:first-child{margin-top:0}`,
    `.slice li.cont{list-style:none}`,
    `.hf{position:absolute;display:grid;grid-template-columns:1fr auto 1fr;gap:12px;` +
      `font:11px/16px var(--font-ui);color:var(--color-text-muted);white-space:nowrap;overflow:hidden}`,
    `.hf span:last-child{text-align:end}.hf span:nth-child(2){text-align:center}`,
  ].join('\n');
}

/** The rules for the document that is measured: the flow in its column, and the floating blocks where they sit. */
export function measureCss(): string {
  return [
    `html,body{margin:0;padding:0}`,
    `#measure{position:relative;width:0;height:0;overflow:visible}`,
    `.flow{position:absolute;top:0}`,
    `.unit{display:flow-root}`,
    `.float{position:absolute;display:flow-root}`,
  ].join('\n');
}
