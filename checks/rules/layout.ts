// Rendering checks for SVG graphics: draws each file in a headless Chromium-based browser and
// measures overlap, padding, edge spacing, text size, safe margins, and scaling (see layout/audit.js).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding, Rule, SourceFile } from '../types.ts';
import { caseProblem } from '../text.ts';
import { decodeHtmlEntities } from '../html.ts';
import { reporter } from './helpers.ts';

const AUDIT = readFileSync(join(import.meta.dirname, '..', 'layout', 'audit.js'), 'utf8');

/**
 * The brand's bundled fonts, under the family names the drawings ask for (docs/BRAND.md). Without them a drawing is
 * measured in whatever the machine falls back to: Segoe UI on Windows, a wider sans on Linux. The same file then
 * fits on one runner and overflows on another. Embedded as data URLs, because a file:// page may not load font files.
 */
const FONTS: [family: string, file: string, weight: string, style: string][] = [
  [
    'Atkinson Hyperlegible Next',
    '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2',
    '200 800',
    'normal',
  ],
  [
    'Atkinson Hyperlegible Next',
    '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2',
    '200 800',
    'italic',
  ],
  ['Literata', '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2', '200 900', 'normal'],
  ['Literata', '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2', '200 900', 'italic'],
  [
    'Atkinson Hyperlegible Mono',
    '@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2',
    '400',
    'normal',
  ],
  [
    'Atkinson Hyperlegible Mono',
    '@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-600-normal.woff2',
    '600',
    'normal',
  ],
];

let fontFaces: string | null = null;

/** The @font-face rules for the bundled fonts, or nothing when they are not installed. */
export function brandFontFaces(): string {
  if (fontFaces !== null) return fontFaces;
  const modules = join(import.meta.dirname, '..', '..', 'node_modules');
  fontFaces = FONTS.filter(([, file]) => existsSync(join(modules, file)))
    .map(([family, file, weight, style]) => {
      const data = readFileSync(join(modules, file)).toString('base64');
      const src = `url(data:font/woff2;base64,${data}) format('woff2')`;
      return `@font-face{font-family:'${family}';src:${src};font-weight:${weight};font-style:${style}}`;
    })
    .join('');
  return fontFaces;
}

const BROWSER_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

let browser: string | undefined | null = null;

/** Finds a Chromium-based browser: CHECKS_BROWSER, a Playwright install, or a system browser. */
export function findBrowser(): string | undefined {
  if (browser !== null) return browser;
  const fromPlaywright = playwrightShell();
  const candidates = [process.env.CHECKS_BROWSER, fromPlaywright, ...BROWSER_CANDIDATES];
  browser = candidates.find((path): path is string => !!path && existsSync(path));
  return browser;
}

function playwrightShell(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const shell = readdirSync(root).find((name) => name.startsWith('chromium_headless_shell'));
  return shell ? join(root, shell, 'chrome-linux', 'headless_shell') : undefined;
}

interface AuditResult {
  message: string;
  text: string;
}

/**
 * Arguments for one headless render. The browser profile lives in `dir`, which the caller deletes;
 * without --user-data-dir, headless Edge leaves a new HeadlessEdge profile in the temp folder on every run.
 */
export function browserArgs(dir: string): string[] {
  const profile = `--user-data-dir=${join(dir, 'profile')}`;
  return ['--headless', '--no-sandbox', '--disable-gpu', profile, '--virtual-time-budget=3000', '--dump-dom'];
}

function render(svg: string, exe: string): AuditResult[] {
  const dir = mkdtempSync(join(tmpdir(), 'checks-layout-'));
  try {
    const page = join(dir, 'page.html');
    const html = [
      `<!doctype html><html><head><meta charset="utf-8"><style>${brandFontFaces()}</style></head>`,
      '<body style="margin:0">',
      svg,
      // The audit measures text, so it waits until the bundled fonts have loaded.
      `<pre id="out"></pre><script>Promise.all([...document.fonts].map((f) => f.load())).then(() => {${AUDIT}})</script>`,
      '</body></html>',
    ].join('');
    writeFileSync(page, html);
    const dom = execFileSync(exe, [...browserArgs(dir), `file://${page}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const json = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)?.[1] ?? '';
    if (!json) throw new Error('the audit script produced no result');
    return JSON.parse(decodeHtmlEntities(json));
  } finally {
    // The browser's helper processes can hold profile files for a moment after it exits.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function lineOf(file: SourceFile, text: string): number {
  if (!text) return 1;
  const index = file.lines.findIndex((l) => l.includes(`>${text.slice(0, 20)}`));
  return index === -1 ? 1 : index + 1;
}

/** Interface text in drawings follows docs/BRAND.md: sentence case, with single-word overlines allowed. */
function caseFindings(file: SourceFile): Finding[] {
  const report = reporter('layout', file);
  const findings: Finding[] = [];
  file.lines.forEach((raw, i) => {
    for (const match of raw.matchAll(/<text[^>]*>([^<]+)<\/text>/g)) {
      const problem = caseProblem(match[1].trim());
      if (problem) findings.push(report(i + 1, problem, 'warning'));
    }
  });
  return findings;
}

export const layout: Rule = {
  id: 'layout',
  description: 'Renders SVGs and checks overlap, padding, edge spacing, text size, safe margins, and scaling.',
  appliesTo: (file) => file.ext === 'svg',
  check(file) {
    const report = reporter('layout', file);
    const findings: Finding[] = caseFindings(file);
    const exe = findBrowser();
    if (!exe)
      return [
        ...findings,
        report(1, 'Layout not checked: no Chromium-based browser found. Set CHECKS_BROWSER.', 'warning'),
      ];
    for (const r of render(file.text, exe)) {
      const where = r.text ? `"${r.text}": ` : '';
      findings.push(report(lineOf(file, r.text), `${where}${r.message}`));
    }
    return findings;
  },
};
