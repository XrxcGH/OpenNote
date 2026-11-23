// The function reference (docs/help/table-functions.md) is generated from the registry and the description strings.
// Run with UPDATE_DOCS=1 to rewrite it. Without that, the test fails when the page is out of date, so every registered
// function appears in it and a new function cannot ship undocumented.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fnArrays } from '../../../../../strings/en/fnArrays';
import { fnDateTime } from '../../../../../strings/en/fnDateTime';
import { fnFinance } from '../../../../../strings/en/fnFinance';
import { fnLogicInfo } from '../../../../../strings/en/fnLogicInfo';
import { fnLookup } from '../../../../../strings/en/fnLookup';
import { fnMath } from '../../../../../strings/en/fnMath';
import { fnStats } from '../../../../../strings/en/fnStats';
import { fnText } from '../../../../../strings/en/fnText';
import { REGISTRY } from './index';
import type { Family } from './types';

const docs = resolve(import.meta.dirname, '../../../../../../../docs/help');
const page = join(docs, 'table-functions.md');
const texts: Record<string, unknown>[] = [
  fnArrays,
  fnDateTime,
  fnFinance,
  fnLogicInfo,
  fnLookup,
  fnMath,
  fnStats,
  fnText,
];

const TITLES: Record<Family, string> = {
  math: 'Math and trigonometry',
  arrays: 'Arrays',
  stats: 'Statistics',
  statsCompat: 'Statistics, older names',
  finance: 'Finance',
  text: 'Text',
  regex: 'Regular expressions',
  datetime: 'Date and time',
  lookup: 'Lookup and reference',
  logical: 'Logic',
  info: 'Information',
  engineering: 'Engineering',
  database: 'Database',
  sheetsCompat: 'Google Sheets names',
};

function describe1(name: string): string {
  for (const group of texts) {
    const entry = (group[name] ?? group[name.replace(/[.]/g, '_')]) as
      { description?: string; summary?: string; about?: string } | undefined;
    const text = entry?.description ?? entry?.summary ?? entry?.about;
    if (text) return text;
  }
  return '';
}

function render(): string {
  const byFamily = new Map<Family, string[]>();
  for (const spec of [...REGISTRY.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const rows = byFamily.get(spec.family) ?? [];
    const cell = (s: string) => s.replace(/[|]/g, '\\|');
    rows.push(`| \`${spec.name}\` | \`${cell(spec.meta.signature)}\` | ${cell(describe1(spec.name))} |`);
    byFamily.set(spec.family, rows);
  }
  const out = [
    '# Table function reference',
    '',
    `Every function a table formula can use, ${REGISTRY.size} in all.`,
    'This page is generated from the function registry. Do not edit it by hand.',
    '',
    'Square brackets mark an optional argument. "..." means the argument can repeat.',
    'See [Tables and charts](tables-and-charts.md) for how formulas work.',
    'See [Table formatting](table-formatting.md) for number formats.',
    '',
  ];
  for (const family of Object.keys(TITLES) as Family[]) {
    const rows = byFamily.get(family);
    if (!rows) continue;
    out.push(`## ${TITLES[family]}`, '', '| Function | Call | What it does |', '| --- | --- | --- |', ...rows, '');
  }
  return out.join('\n');
}

describe('function reference page', () => {
  it('is up to date and lists every registered function', () => {
    const text = render();
    if (process.env.UPDATE_DOCS === '1') writeFileSync(page, text);
    expect(readFileSync(page, 'utf8')).toBe(text);
    for (const name of REGISTRY.keys()) expect(text, name).toContain(`\`${name}\``);
    for (const name of REGISTRY.keys()) expect(describe1(name), `${name} has no description`).not.toBe('');
  });

  it('has links on the table help pages that all resolve', () => {
    for (const file of ['tables-and-charts.md', 'table-formatting.md', 'table-functions.md']) {
      expect(existsSync(join(docs, file)), file).toBe(true);
      for (const m of readFileSync(join(docs, file), 'utf8').matchAll(/\]\(([^)#:]+\.md)(#[^)]*)?\)/g)) {
        const target = resolve(dirname(join(docs, file)), m[1]!);
        expect(existsSync(target), `${file} -> ${m[1]}`).toBe(true);
      }
    }
    expect(readdirSync(docs).length).toBeGreaterThan(0);
  });
});

describe('engine README', () => {
  it('names every folder of the engine and links to the function reference', () => {
    const engine = resolve(import.meta.dirname, '../..');
    const readme = readFileSync(join(engine, 'README.md'), 'utf8');
    for (const entry of readdirSync(engine, { withFileTypes: true })) {
      if (entry.isDirectory() && readdirSync(join(engine, entry.name)).length > 0)
        expect(readme, entry.name).toContain(`\`${entry.name}/\``);
    }
    expect(readme).toContain('table-functions.md');
  });
});
