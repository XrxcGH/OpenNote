// Shared types for the CHECKS program. Rules receive a SourceFile and return Findings.

export type Severity = 'error' | 'warning';

export type FileKind = 'markdown' | 'text' | 'code' | 'data' | 'other';

/** Where a piece of prose came from, so rules can skip contexts they don't care about. */
export type ProseContext = 'paragraph' | 'heading' | 'list' | 'table' | 'quote' | 'comment';

/** One line of natural-language text, already stripped of markup. */
export interface ProseLine {
  line: number;
  raw: string;
  text: string;
  context: ProseContext;
  headingLevel?: number;
}

/** Consecutive prose lines that read as one unit: a paragraph, list item, heading, or table row. */
export interface ProseBlock {
  line: number;
  text: string;
  context: ProseContext;
  headingLevel?: number;
}

/** A safe, mechanical edit: replace the first whole-word match of `from` on `line` with `to`. */
export interface Fix {
  line: number;
  from: string;
  to: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  fix?: Fix;
}

export interface Threshold {
  warn: number;
  error: number;
}

export interface RuleSettings {
  severity?: Severity | 'off';
  exclude?: string[];
  [key: string]: unknown;
}

export interface Config {
  ignore: string[];
  rules: Record<string, RuleSettings>;
}

export interface SourceFile {
  path: string;
  text: string;
  lines: string[];
  kind: FileKind;
  ext: string;
  prose(): ProseLine[];
  blocks(): ProseBlock[];
  codeOnly(): string[];
}

export interface RuleContext {
  config: Config;
  settings: RuleSettings;
  repoRoot: string;
  fileExists(relPath: string): boolean;
  readRepoFile(relPath: string): string | undefined;
  markdownFiles(): string[];
}

export interface Rule {
  id: string;
  description: string;
  appliesTo(file: SourceFile): boolean;
  check(file: SourceFile, ctx: RuleContext): Finding[] | Promise<Finding[]>;
}
