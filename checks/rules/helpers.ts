// Helpers shared by rule modules.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, Fix, Severity, SourceFile } from '../types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data');

export function loadData<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T;
}

export type Report = (line: number, message: string, severity?: Severity, fix?: Fix) => Finding;

/** Returns a function that builds findings for one rule and one file. */
export function reporter(rule: string, file: SourceFile): Report {
  return (line, message, severity = 'error', fix) => ({ rule, severity, file: file.path, line, message, fix });
}

export function isProseFile(file: SourceFile): boolean {
  return file.kind === 'markdown' || file.kind === 'text';
}

/** Normalizes text for duplicate detection: lowercase letters and digits only. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
