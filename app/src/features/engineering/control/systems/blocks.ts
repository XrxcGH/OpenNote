// Block diagram algebra written as nested steps: series(a, b, …), parallel(a, b, …), feedback(g, h) for negative
// feedback and posfeedback(g, h) for positive, where each block is a transfer function such as 10/(s + 1). Each
// reduction becomes a worked step, inner ones first.
import { ControlError } from '../lib/errors';
import { step, type Step } from '../lib/steps';
import { feedback, minreal, parallel, readTF, series, tfTex, type TF } from '../lib/tf';

const OPS = ['series', 'parallel', 'feedback', 'posfeedback'] as const;
type Op = (typeof OPS)[number];
export const MAX_BLOCKS = 30;

/** Splits "a, b(c, d), e" at the commas outside brackets. */
function splitArgs(text: string, at: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth < 0) throw new ControlError('blocksSyntax', { at: String(at + i + 1) });
    if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new ControlError('blocksSyntax', { at: String(at + text.length) });
  out.push(text.slice(start));
  return out;
}

interface Ctx {
  steps: Step[];
  blocks: number;
}

function reduce(text: string, at: number, ctx: Ctx): TF {
  const trimmed = text.trim();
  const lead = text.length - text.trimStart().length;
  const m = /^([a-z]+)\s*\(([\s\S]*)\)$/i.exec(trimmed);
  const op = m?.[1].toLowerCase() as Op | undefined;
  const named = /^([a-z]+)\s*\(/i.exec(trimmed);
  if (!m && named && OPS.includes(named[1].toLowerCase() as Op)) {
    throw new ControlError('blocksSyntax', { at: String(at + text.length) });
  }
  if (!m || !op || !OPS.includes(op)) {
    ctx.blocks += 1;
    if (ctx.blocks > MAX_BLOCKS) throw new ControlError('blocksTooMany', { max: String(MAX_BLOCKS) });
    if (!trimmed) throw new ControlError('blocksEmpty', { at: String(at + 1) });
    try {
      return readTF(trimmed);
    } catch {
      throw new ControlError('blocksBlock', { block: trimmed, at: String(at + lead + 1) });
    }
  }
  const innerAt = at + lead + m[1].length + 1;
  const args = splitArgs(m[2], innerAt);
  let offset = innerAt;
  const parts = args.map((a) => {
    const g = reduce(a, offset, ctx);
    offset += a.length + 1;
    return g;
  });
  let out: TF;
  if (op === 'series' || op === 'parallel') {
    if (parts.length < 2) throw new ControlError('blocksArgs', { op, n: '2' });
    out = parts.slice(1).reduce((acc, g) => (op === 'series' ? series(acc, g) : parallel(acc, g)), parts[0]);
  } else {
    if (parts.length < 1 || parts.length > 2) throw new ControlError('blocksFeedback', { op });
    out = feedback(parts[0], parts[1], op === 'feedback' ? -1 : 1);
  }
  out = minreal(out).tf;
  const formula = {
    series: 'G_1 G_2 \\cdots',
    parallel: 'G_1 + G_2 + \\cdots',
    feedback: '\\frac{G}{1 + GH}',
    posfeedback: '\\frac{G}{1 - GH}',
  }[op];
  ctx.steps.push(step(`blocks.${op}`, {}, `${formula} = ${tfTex(out)}`));
  return out;
}

/** The overall transfer function of a block diagram, with a step for each reduction. */
export function reduceDiagram(text: string): { tf: TF; steps: Step[] } {
  if (!text.trim()) throw new ControlError('blocksEmpty', { at: '1' });
  const ctx: Ctx = { steps: [], blocks: 0 };
  const tf = reduce(text, 0, ctx);
  return { tf, steps: ctx.steps };
}
