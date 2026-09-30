// Minimal glob matching for config patterns: `**`, `*`, `?` and `{a,b}`.

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const [piece, consumed] = translate(glob, i);
    pattern += piece;
    i += consumed;
  }
  const regex = new RegExp(`^${pattern}$`);
  cache.set(glob, regex);
  return regex;
}

function translate(glob: string, i: number): [string, number] {
  const char = glob[i];
  if (glob.startsWith('**/', i)) return ['(?:.*/)?', 3];
  if (glob.startsWith('**', i)) return ['.*', 2];
  if (char === '*') return ['[^/]*', 1];
  if (char === '?') return ['[^/]', 1];
  if (char === '{') {
    const end = glob.indexOf('}', i);
    if (end !== -1) {
      const options = glob
        .slice(i + 1, end)
        .split(',')
        .map(escape);
      return [`(?:${options.join('|')})`, end - i + 1];
    }
  }
  return [escape(char), 1];
}

function escape(text: string): string {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
