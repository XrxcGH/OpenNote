// Every tool of the kit, run through the window's own path: each example and the first texts give results, every
// key the tool builds has words in the strings with the values they name, and every plot draws.
import '../text';
import { describe, expect, it } from 'vitest';
import { en } from '../../../../strings/en';
import { CONTROL_TOOLS } from '../meta';
import { SPECS } from '../specs';
import { answerLatex, answerText, columnText, plotText, resultTable, stepsHtml, type InsertContext } from './insert';
import { PAGE, SCREEN } from './plot';
import { runTool } from './read';
import { firstTexts, type ToolSpec } from './spec';

function lookup(key: string): string | undefined {
  let at: unknown = en;
  for (const part of key.split('.')) {
    if (typeof at !== 'object' || at === null || !(part in at)) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return typeof at === 'string' ? at : undefined;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const missing: string[] = [];

/** A say that records keys with no words and placeholders with no value. */
function say(key: string, params: Readonly<Record<string, string | number>> = {}): string {
  const text = lookup(key);
  if (text === undefined) {
    missing.push(key);
    return key;
  }
  for (const name of placeholders(text)) if (!(name in params)) missing.push(`${key} {${name}}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

async function specOf(id: string): Promise<ToolSpec> {
  const load = SPECS[id];
  expect(load, `spec for ${id}`).toBeDefined();
  return load();
}

function exercise(tool: string, spec: ToolSpec, texts: Record<string, string>, system: 'si' | 'us' = 'si') {
  const run = runTool(spec, texts, system);
  if (!run.ok) {
    const problems = [...run.fields.map((f) => `${f.field}: ${f.problem.key}`), run.error?.key];
    throw new Error(`${tool} did not run: ${problems.join(', ')}`);
  }
  const c: InsertContext = { tool, outcome: run.outcome, system, say };
  // A LaTeX string written with one backslash too few turns \b or \f into a control character.
  const control = (text: string) => [...text].some((ch) => ch.charCodeAt(0) < 9 || '\v\f'.includes(ch));
  for (const one of run.outcome.steps) expect(control(one.math ?? ''), one.key).toBe(false);
  expect(control(answerLatex(c))).toBe(false);
  answerText(c);
  resultTable(c);
  stepsHtml(c);
  for (const table of run.outcome.tables ?? []) {
    say(`kitControl.${tool}.table.${table.id}`);
    table.columns.forEach((col) => columnText(c, col));
  }
  for (const note of run.outcome.notes ?? []) say(`kitControl.${tool}.note.${note.id}`, note.vars);
  for (const plot of run.outcome.plots ?? []) {
    for (const palette of [SCREEN, PAGE]) {
      const svg = plotText(c, plot, palette);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
  }
  return run.outcome;
}

describe('the dynamics and control kit', () => {
  it('lists each tool once, with a spec and words for its title, tab, keywords, and lead', () => {
    const ids = CONTROL_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of CONTROL_TOOLS) {
      expect(SPECS[tool.id]).toBeDefined();
      for (const key of [tool.title, tool.tab, tool.keywords, `kitControl.${tool.id}.lead`]) {
        expect(lookup(key), key).toBeDefined();
      }
    }
  });

  for (const tool of CONTROL_TOOLS) {
    it(`runs every example of ${tool.id} with words for every key`, async () => {
      missing.length = 0;
      const spec = await specOf(tool.id);
      for (const field of spec.fields) {
        say(`kitControl.${tool.id}.field.${field.id}`);
        if (field.type === 'choice') field.options.forEach((o) => say(`kitControl.${tool.id}.option.${o}`));
        if (field.type === 'text') say(`kitControl.${tool.id}.hint.${field.id}`);
      }
      exercise(tool.id, spec, firstTexts(spec));
      for (const example of spec.examples ?? []) {
        say(`kitControl.${tool.id}.example.${example.id}`);
        exercise(tool.id, spec, { ...firstTexts(spec), ...example.texts });
        exercise(tool.id, spec, { ...firstTexts(spec), ...example.texts }, 'us');
      }
      expect(missing).toEqual([]);
    });
  }
});

// Every error code and step key an engine names has words, found by reading the engines' source.
const SOURCES = import.meta.glob(['../*/*.ts', '!../*/*.test.ts', '!../ui/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('the engines’ words', () => {
  it('has words for every error code and step key in the engines', () => {
    const absent: string[] = [];
    const listed = new Set(['lib', ...CONTROL_TOOLS.map((tool) => tool.id)]);
    for (const [file, source] of Object.entries(SOURCES)) {
      if (!listed.has(file.split('/')[1])) continue;
      // The first argument up to a comma, bracket, or brace: a key, or a chain of ternaries choosing one.
      for (const m of source.matchAll(/new ControlError\(\s*([^(){},`]{0,160})/g)) {
        for (const code of [...m[1].matchAll(/'(\w+)'(?!\s*\?)/g)].map((k) => k[1])) {
          if (lookup(`kitControl.errors.${code}`) === undefined) absent.push(`${file}: errors.${code}`);
        }
      }
      for (const m of source.matchAll(/\bstep\(\s*([^(){},`]{0,160})/g)) {
        for (const key of [...m[1].matchAll(/'(\w+\.[\w.]+)'/g)].map((k) => k[1])) {
          if (lookup(`kitControl.steps.${key}`) === undefined) absent.push(`${file}: steps.${key}`);
        }
      }
    }
    expect(absent).toEqual([]);
  });
});
