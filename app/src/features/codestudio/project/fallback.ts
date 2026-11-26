// The project's fallback (DESIGN 3.1): a bold name with the language and file count, then every file as a
// heading and a fenced block. Search indexes it, so search finds code; page.md, Markdown, PDF, and web page exports
// show it; and an app without code projects shows it read-only. It stops at 256 KiB with "…and N more lines".

import { t } from '../../../strings/t';
import { PROJECT_LIMITS } from '../contracts';
import type { CodeProject } from '../contracts';
import { sortedFiles, utf8Bytes } from './model';

/** The fence info string for a file, by its extension. Files with no known extension get a bare fence. */
const FENCE_LANGUAGES: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  sql: 'sql',
  lua: 'lua',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  rb: 'ruby',
  r: 'r',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  dart: 'dart',
  sh: 'bash',
  ps1: 'powershell',
  php: 'php',
  jl: 'julia',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
};

export function fenceLanguage(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : (FENCE_LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? '');
}

/** Markdown with its emphasis, code, link, and HTML characters escaped, so a path reads as typed. */
function escaped(text: string): string {
  return text.replace(/[\\`*_[\]<>#]/g, (char) => `\\${char}`);
}

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  return '`'.repeat(longest + 1);
}

/** Room kept for the closing fence and the "more lines" note when the fallback is cut. */
const RESERVE = 256;

/** The fallback Markdown of a project. */
export function projectFallback(project: CodeProject, limit: number = PROJECT_LIMITS.fallbackBytes): string {
  const files = sortedFiles(project.files);
  const language = t(`codeStudio.project.languages.${project.language}`);
  const summary = t('codeStudio.project.fallback.summary', { language, count: files.length });
  const name = escaped(project.name.trim()) || t('codeStudio.project.block');
  const out: string[] = [`**${name}** ${summary}`];
  let bytes = utf8Bytes(out[0]) + 1;
  const push = (line: string) => {
    out.push(line);
    bytes += utf8Bytes(line) + 1;
  };
  for (let index = 0; index < files.length; index++) {
    const [, file] = files[index];
    const text = file.text.replace(/\n$/, '');
    const fence = fenceFor(text);
    const lines = text.length === 0 ? [] : text.split('\n');
    const head = ['', `#### ${escaped(file.path)}`, '', `${fence}${fenceLanguage(file.path)}`];
    if (bytes + utf8Bytes(head.join('\n')) + RESERVE > limit) {
      return cut(out, countLines(files, index, 0));
    }
    head.forEach(push);
    for (let line = 0; line < lines.length; line++) {
      if (bytes + utf8Bytes(lines[line]) + 1 + RESERVE > limit) {
        push(fence);
        return cut(out, countLines(files, index, line));
      }
      push(lines[line]);
    }
    push(fence);
  }
  return `${out.join('\n')}\n`;
}

/** The lines not shown: the rest of file `index` from `line`, and every file after it. */
function countLines(files: [string, CodeProject['files'][string]][], index: number, line: number): number {
  let count = 0;
  for (let i = index; i < files.length; i++) {
    const text = files[i][1].text.replace(/\n$/, '');
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    count += i === index ? Math.max(0, lines - line) : lines;
  }
  return count;
}

function cut(out: string[], more: number): string {
  return `${[...out, '', t('codeStudio.project.fallback.more', { count: more })].join('\n')}\n`;
}
