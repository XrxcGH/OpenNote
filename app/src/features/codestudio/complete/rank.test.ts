// Ranking known answers (DESIGN 10.2, lane code:L12). The expected names are hand-worked: a parameter of the
// enclosing function, the list methods the Python documentation lists, and the C++ and JavaScript members their
// references document. The tree comes from the same Lezer grammars the editor uses.
import { cppLanguage } from '@codemirror/lang-cpp';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { pythonLanguage } from '@codemirror/lang-python';
import { afterEach, describe, expect, it } from 'vitest';
import { contextAt } from './ghost';
import { forgetPicks, LEAD_MARGIN, leader, matchScore, rank, rememberPick } from './rank';

const PARSERS = { python: pythonLanguage.parser, javascript: javascriptLanguage.parser, cpp: cppLanguage.parser };

/** The ranked labels at the end of `text` (or at `|`), parsed like the editor parses it. */
function labels(language: keyof typeof PARSERS, source: string): string[] {
  const pos = source.includes('|') ? source.indexOf('|') : source.length;
  const text = source.replace('|', '');
  const tree = PARSERS[language].parse(text);
  return rank(contextAt(language, text, pos), { tree }).map((item) => item.label);
}

afterEach(() => forgetPicks());

describe('the ranked list', () => {
  it('puts the parameter first in "def area(radius):\\n    return rad"', () => {
    expect(labels('python', 'def area(radius):\n    return rad')[0]).toBe('radius');
  });

  it('offers list methods after "nums." with append in the top three', () => {
    const top = labels('python', 'nums = [3, 1, 2]\nnums.').slice(0, 3);
    expect(top).toContain('append');
  });

  it('offers string methods after a string literal and math members after "math."', () => {
    expect(labels('python', 'name = "ada"\nname.').slice(0, 3)).toContain('join');
    expect(labels('python', 'import math\nmath.sq')[0]).toBe('sqrt');
  });

  it('knows JavaScript arrays and C++ vectors', () => {
    expect(labels('javascript', 'const items = [];\nitems.').slice(0, 3)).toContain('push');
    expect(labels('cpp', 'std::vector<int> values;\nvalues.').slice(0, 3)).toContain('push_back');
  });

  it('offers nothing after a dot whose receiver is unknown', () => {
    expect(labels('python', 'def get():\n    return 1\nvalue = get().')).toEqual([]);
    expect(labels('python', 'rows = [[1]]\nrows[0].')).toEqual([]);
    expect(labels('python', 'x = 3.')).toEqual([]);
    expect(labels('javascript', 'const total = 1;\nfetch(url)\n  .')).toEqual([]);
    // A spread is not a member access.
    expect(labels('javascript', 'const items = [];\nconst more = [...ite')).toContain('items');
  });

  it('reads parameter and bare annotations, and the nearest assignment before the caret', () => {
    expect(labels('python', 'def f(name: str):\n    return name.').slice(0, 3)).toContain('join');
    expect(labels('python', 'nums: list[int]\nnums.').slice(0, 3)).toContain('append');
    expect(labels('python', 'def g(self, rows: list, k=1):\n    rows.').slice(0, 3)).toContain('append');
    expect(labels('python', 'data = "a"\ndata = []\ndata.').slice(0, 3)).toContain('append');
    // An assignment after the caret does not count.
    expect(labels('python', 'data = []\ndata.|\ndata = "a"').slice(0, 3)).toContain('append');
    expect(labels('javascript', 'function f(items: string[]) {\n  items.').slice(0, 3)).toContain('push');
    expect(labels('javascript', 'const f = (items?: number[]) => items.').slice(0, 3)).toContain('push');
  });

  it('ranks a nearer scope above a farther one, and a scope name above a keyword', () => {
    const text = 'value_outer = 1\ndef f(value_inner):\n    return valu';
    expect(labels('python', text).slice(0, 2)).toEqual(['value_inner', 'value_outer']);
    expect(labels('python', 'retry = 3\nre')[0]).toBe('retry');
  });

  it('hides names from another function', () => {
    const text = 'def a(secret):\n    pass\ndef b(other):\n    return sec';
    const found = rank(contextAt('python', text.replace('|', ''), text.length), {
      tree: pythonLanguage.parser.parse(text),
    });
    expect(found.find((item) => item.label === 'secret')?.source).toBe('words');
  });

  it('is deterministic: equal scores sort alphabetically', () => {
    const first = labels('python', 'b_two = 1\nb_one = 1\nb');
    expect(labels('python', 'b_two = 1\nb_one = 1\nb')).toEqual(first);
    const items = rank(contextAt('python', 'x', 1));
    for (let i = 1; i < items.length; i++) {
      const [a, b] = [items[i - 1]!, items[i]!];
      expect(a.score > b.score || (a.score === b.score && a.label <= b.label)).toBe(true);
    }
  });

  it('includes snippets with fields and keywords from the frequency table', () => {
    const items = rank(contextAt('python', 'fo', 2));
    const snippet = items.find((item) => item.snippet && item.label === 'for');
    expect(snippet?.insert).toBe('for ${1:item} in ${2:items}:\n\t${3:pass}');
    expect(items.some((item) => item.kind === 'keyword' && item.label === 'for')).toBe(true);
  });

  it('boosts items accepted earlier in the session', () => {
    const text = 'alpha_one = 1\nalpha_two = 2\nalpha';
    const tree = pythonLanguage.parser.parse(text);
    const before = rank(contextAt('python', text, text.length), { tree }).map((item) => item.label);
    rememberPick(before[1]!);
    const after = rank(contextAt('python', text, text.length), { tree }).map((item) => item.label);
    expect(after[0]).toBe(before[1]);
  });

  it('matches a prefix above another case above letters in order', () => {
    expect(matchScore('radius', 'rad')).toBe(3);
    expect(matchScore('Radius', 'rad')).toBe(2);
    expect(matchScore('read_all', 'rdl')).toBe(1);
    expect(matchScore('radius', 'xyz')).toBeNull();
  });
});

describe('SQL members, snippet notes, and unknown languages', () => {
  it('offers SQL columns after "table." from the CREATE TABLE', () => {
    const sql = (text: string) => rank(contextAt('sql', text, text.length)).map((item) => item.label);
    expect(sql('CREATE TABLE users (id INT, name TEXT);\nSELECT users.')).toEqual(['id', 'name']);
    const keyed = 'CREATE TABLE IF NOT EXISTS "users" (\n  id INT,\n  name VARCHAR(20, 0),\n  PRIMARY KEY (id)\n);\n';
    // An alias after FROM names the table; a constraint item is not a column.
    const aliased = `${keyed}SELECT u. FROM users u`;
    const at = keyed.length + 'SELECT u.'.length;
    expect(rank(contextAt('sql', aliased, at)).map((item) => item.label)).toEqual(['id', 'name']);
  });

  it('marks snippets as snippets in the list', () => {
    const item = rank(contextAt('python', 'fo', 2)).find((entry) => entry.snippet);
    expect(item?.detail).toMatch(/^snippet: /);
  });

  it('treats a language named like an object key as unknown', () => {
    for (const language of ['constructor', 'toString', '__proto__']) {
      expect(() => rank(contextAt(language, 'value = 1\nva', 12))).not.toThrow();
    }
  });
});

describe('the leader for an explicit request', () => {
  it('returns the rest of a word whose top item leads by the margin', () => {
    const text = 'total = 0\nfor n in nums:\n    tot';
    const tree = pythonLanguage.parser.parse(text);
    expect(leader(contextAt('python', text, text.length), { tree })).toBe('al');
  });

  it('returns nothing when two items are close', () => {
    const text = 'count_a = 1\ncount_b = 2\ncou';
    const tree = pythonLanguage.parser.parse(text);
    const [top, second] = rank(contextAt('python', text, text.length), { tree });
    expect(top!.score - second!.score).toBeLessThan(LEAD_MARGIN);
    expect(leader(contextAt('python', text, text.length), { tree })).toBeNull();
  });

  it('returns nothing inside a word or with no word', () => {
    expect(leader(contextAt('python', 'total = 0\ntot', 11))).toBeNull();
    expect(leader(contextAt('python', '', 0))).toBeNull();
  });
});
