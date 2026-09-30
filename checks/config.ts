// Loads checks.config.json and merges it over the built-in defaults.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, RuleSettings, Severity, Threshold } from './types.ts';

export const DEFAULT_CONFIG: Config = {
  ignore: ['node_modules/**', '**/node_modules/**', '**/dist/**', '**/target/**', 'package-lock.json', '**/*.lock'],
  rules: {},
};

export function loadConfig(repoRoot: string): Config {
  const path = join(repoRoot, 'checks.config.json');
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  return {
    ignore: [...DEFAULT_CONFIG.ignore, ...(parsed.ignore ?? [])],
    rules: { ...DEFAULT_CONFIG.rules, ...(parsed.rules ?? {}) },
  };
}

/** Reads a numeric threshold from rule settings, falling back to a default. */
export function threshold(settings: RuleSettings, key: string, fallback: Threshold): Threshold {
  const value = settings[key] as Partial<Threshold> | undefined;
  return { warn: value?.warn ?? fallback.warn, error: value?.error ?? fallback.error };
}

/** Returns the severity a measured value earns against a threshold, or undefined if it passes. */
export function grade(value: number, limit: Threshold): Severity | undefined {
  if (value > limit.error) return 'error';
  if (value > limit.warn) return 'warning';
  return undefined;
}

export function stringList(settings: RuleSettings, key: string): string[] {
  const value = settings[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function numberSetting(settings: RuleSettings, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === 'number' ? value : fallback;
}
