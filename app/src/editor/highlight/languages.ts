// The code languages OpenNote names and colors (ARCHITECTURE.md section 14.2; owner: WP6). This list is small and
// loads with the editor, for the language button and the picker. Each language's grammar loads only when a page
// shows code in it (grammars.ts). A code block keeps the info string it was written with, such as "py".

export interface CodeLanguage {
  /** The info string the picker writes. */
  readonly id: string;
  /** The name people see. Language names are proper nouns, so they stay as they are in every locale. */
  readonly name: string;
  /** Other info strings that mean this language, in lowercase. */
  readonly aliases: readonly string[];
  /** The highlight.js grammar that colors it. */
  readonly grammar: string;
  /** The indent a new block in this language uses, until its own lines show another. */
  readonly indent: 2 | 4;
}

const language = (
  id: string,
  name: string,
  aliases: readonly string[] = [],
  indent: 2 | 4 = 4,
  grammar = id,
): CodeLanguage => ({ id, name, aliases, grammar, indent });

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  language('bash', 'Bash', ['sh', 'shell', 'zsh', 'console'], 2),
  language('c', 'C', ['h']),
  language('cpp', 'C++', ['c++', 'cc', 'cxx', 'hpp', 'hh']),
  language('csharp', 'C#', ['cs', 'c#']),
  language('css', 'CSS', [], 2),
  language('dart', 'Dart', [], 2),
  language('diff', 'Diff', ['patch'], 2),
  language('dockerfile', 'Dockerfile', ['docker'], 2),
  language('elixir', 'Elixir', ['ex', 'exs'], 2),
  language('fsharp', 'F#', ['fs', 'f#']),
  language('go', 'Go', ['golang']),
  language('graphql', 'GraphQL', ['gql'], 2),
  language('haskell', 'Haskell', ['hs'], 2),
  language('html', 'HTML', ['xhtml', 'svg', 'vue'], 2, 'xml'),
  language('ini', 'INI', ['toml', 'cfg', 'conf'], 2),
  language('java', 'Java'),
  language('javascript', 'JavaScript', ['js', 'jsx', 'mjs', 'cjs'], 2),
  language('json', 'JSON', ['jsonc', 'json5'], 2),
  language('julia', 'Julia', ['jl']),
  language('kotlin', 'Kotlin', ['kt', 'kts']),
  language('latex', 'LaTeX', ['tex'], 2),
  language('lua', 'Lua', [], 2),
  language('makefile', 'Makefile', ['make', 'mk']),
  language('markdown', 'Markdown', ['md', 'mkd'], 2),
  language('matlab', 'MATLAB', ['m']),
  language('objectivec', 'Objective-C', ['objc', 'obj-c', 'mm']),
  language('perl', 'Perl', ['pl', 'pm']),
  language('php', 'PHP'),
  language('powershell', 'PowerShell', ['ps', 'ps1', 'pwsh']),
  language('python', 'Python', ['py', 'py3', 'gyp']),
  language('r', 'R', [], 2),
  language('ruby', 'Ruby', ['rb', 'gemspec'], 2),
  language('rust', 'Rust', ['rs']),
  language('scala', 'Scala', ['sc'], 2),
  language('scss', 'SCSS', ['sass'], 2),
  language('sql', 'SQL', ['mysql', 'postgres', 'postgresql', 'sqlite']),
  language('swift', 'Swift'),
  language('typescript', 'TypeScript', ['ts', 'tsx', 'mts', 'cts'], 2),
  language('vbnet', 'Visual Basic', ['vb', 'vba']),
  language('xml', 'XML', ['xsd', 'xsl', 'plist', 'rss', 'xaml', 'csproj'], 2),
  language('yaml', 'YAML', ['yml'], 2),
];

const byInfo = new Map<string, CodeLanguage>();
for (const one of CODE_LANGUAGES) for (const key of [one.id, ...one.aliases]) byInfo.set(key, one);

/** The language an info string names, ignoring case, or null for plain text and languages OpenNote doesn't know. */
export function findLanguage(info: string | null | undefined): CodeLanguage | null {
  return info ? (byInfo.get(info.toLowerCase()) ?? null) : null;
}

/** The name to show for an info string: the language's name, or the info string as written. Null is plain text. */
export function languageName(info: string | null | undefined): string | null {
  if (!info) return null;
  return findLanguage(info)?.name ?? info;
}

/** The languages whose name, ID, or alias contains `query`, those that start with it first. */
export function matchLanguages(query: string): CodeLanguage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...CODE_LANGUAGES];
  const keys = (one: CodeLanguage) => [one.name.toLowerCase(), one.id, ...one.aliases];
  const starts = CODE_LANGUAGES.filter((one) => keys(one).some((key) => key.startsWith(q)));
  const contains = CODE_LANGUAGES.filter((one) => !starts.includes(one) && keys(one).some((key) => key.includes(q)));
  return [...starts, ...contains];
}
