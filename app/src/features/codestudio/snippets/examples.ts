// Snippets and examples (DESIGN 5.5): per language, starters (hello, input, loops, functions, classes, reading a
// project file) and algorithms (binary search, breadth-first search, sorting), and SQL samples with a schema. Each
// example carries its tests, so Run tests passes right after the example goes in. Every expected output below was
// worked out by hand from the program and its input; examples.test.ts runs each one in its runtime.

import type { ProjectLanguage, TestCase } from '../contracts';

export type ExampleKind = 'starter' | 'algorithm' | 'sql';

export type ExampleName =
  | 'hello'
  | 'input'
  | 'loops'
  | 'functions'
  | 'classes'
  | 'readFile'
  | 'binarySearch'
  | 'bfs'
  | 'sorting'
  | 'sqlSelect'
  | 'sqlJoin'
  | 'sqlGroup';

export interface Example {
  /** `<language>.<name>`. */
  id: string;
  language: ProjectLanguage;
  name: ExampleName;
  kind: ExampleKind;
  /** The file that runs, which becomes the project's main file. */
  entry: string;
  /** Path to text: the entry and any file it reads. */
  files: Record<string, string>;
  tests: TestCase[];
}

/** Example test IDs start with this, so a newer example replaces an older one's tests and keeps the person's own. */
export const EXAMPLE_TEST_PREFIX = 'ex-';

const KINDS: Record<ExampleName, ExampleKind> = {
  hello: 'starter',
  input: 'starter',
  loops: 'starter',
  functions: 'starter',
  classes: 'starter',
  readFile: 'starter',
  binarySearch: 'algorithm',
  bfs: 'algorithm',
  sorting: 'algorithm',
  sqlSelect: 'sql',
  sqlJoin: 'sql',
  sqlGroup: 'sql',
};

/** An io case: run with this input, compare the output with trailing whitespace ignored. */
const io = (name: ExampleName, n: number, stdin: string, expected: string): TestCase => ({
  id: `${EXAMPLE_TEST_PREFIX}${name}-${n}`,
  name: `${name} ${n}`,
  kind: 'io',
  stdin,
  expected,
  compare: { mode: 'trim' },
  order: n,
});

/** A sql case: the result set as JSON, columns first. */
const sql = (name: ExampleName, columns: string[], rows: (string | number)[][]): TestCase => ({
  id: `${EXAMPLE_TEST_PREFIX}${name}-1`,
  name: `${name} 1`,
  kind: 'sql',
  expected: JSON.stringify({ columns, rows }),
  compare: { mode: 'exact' },
  rowsOrdered: true,
  order: 1,
});

/** A program from its lines, each ending in a line feed. */
const lines = (...rows: string[]): string => rows.map((row) => `${row}\n`).join('');

// Inputs shared by the same algorithm in every language.
const SEARCH_IN = ['1 3 5 7 9 11\n7\n', '2 4 6\n5\n'];
const SEARCH_OUT = ['3', '-1'];
const BFS_IN = ['5 4\n0 1\n0 2\n1 3\n2 4\n0\n', '4 3\n0 1\n1 2\n0 3\n0\n'];
const BFS_OUT = ['0 1 2 3 4', '0 1 3 2'];
const SORT_IN = '5 2 9 1 5 6\n';
const SORT_OUT = '1 2 5 5 6 9';

const STANDARD_TESTS: Partial<Record<ExampleName, TestCase[]>> = {
  hello: [io('hello', 1, '', 'Hello, world!')],
  input: [io('input', 1, 'Ada\n', 'Hello, Ada!'), io('input', 2, 'Grace\n', 'Hello, Grace!')],
  loops: [io('loops', 1, '4\n', '1\n4\n9\n16')],
  functions: [io('functions', 1, '48 18\n', '6'), io('functions', 2, '17 5\n', '1')],
  classes: [io('classes', 1, 'a b c\n', 'c b a')],
  readFile: [io('readFile', 1, '', '16')],
  binarySearch: SEARCH_IN.map((stdin, i) => io('binarySearch', i + 1, stdin, SEARCH_OUT[i]!)),
  bfs: BFS_IN.map((stdin, i) => io('bfs', i + 1, stdin, BFS_OUT[i]!)),
  sorting: [io('sorting', 1, SORT_IN, SORT_OUT)],
};

const PYTHON: Partial<Record<ExampleName, string>> = {
  hello: 'print("Hello, world!")\n',
  input: 'name = input()\nprint(f"Hello, {name}!")\n',
  loops: 'n = int(input())\nfor i in range(1, n + 1):\n    print(i * i)\n',
  functions: lines(
    'def gcd(a, b):',
    '    while b:',
    '        a, b = b, a % b',
    '    return a',
    '',
    '',
    'a, b = map(int, input().split())',
    'print(gcd(a, b))',
  ),
  classes: lines(
    'class Stack:',
    '    def __init__(self):',
    '        self.items = []',
    '',
    '    def push(self, item):',
    '        self.items.append(item)',
    '',
    '    def pop(self):',
    '        return self.items.pop()',
    '',
    '    def __len__(self):',
    '        return len(self.items)',
    '',
    '',
    'stack = Stack()',
    'for word in input().split():',
    '    stack.push(word)',
    'print(" ".join(stack.pop() for _ in range(len(stack))))',
  ),
  readFile: lines(
    'total = 0',
    'with open("data.txt") as numbers:',
    '    for line in numbers:',
    '        total += int(line)',
    'print(total)',
  ),
  binarySearch: lines(
    'def binary_search(items, target):',
    '    low, high = 0, len(items) - 1',
    '    while low <= high:',
    '        middle = (low + high) // 2',
    '        if items[middle] == target:',
    '            return middle',
    '        if items[middle] < target:',
    '            low = middle + 1',
    '        else:',
    '            high = middle - 1',
    '    return -1',
    '',
    '',
    'items = [int(word) for word in input().split()]',
    'print(binary_search(items, int(input())))',
  ),
  bfs: lines(
    'from collections import deque',
    '',
    'n, m = map(int, input().split())',
    'neighbors = [[] for _ in range(n)]',
    'for _ in range(m):',
    '    u, v = map(int, input().split())',
    '    neighbors[u].append(v)',
    '    neighbors[v].append(u)',
    'start = int(input())',
    'seen = {start}',
    'order = []',
    'queue = deque([start])',
    'while queue:',
    '    node = queue.popleft()',
    '    order.append(node)',
    '    for nxt in sorted(neighbors[node]):',
    '        if nxt not in seen:',
    '            seen.add(nxt)',
    '            queue.append(nxt)',
    'print(" ".join(map(str, order)))',
  ),
  sorting: lines(
    'def insertion_sort(items):',
    '    for i in range(1, len(items)):',
    '        key = items[i]',
    '        j = i - 1',
    '        while j >= 0 and items[j] > key:',
    '            items[j + 1] = items[j]',
    '            j -= 1',
    '        items[j + 1] = key',
    '    return items',
    '',
    '',
    'items = [int(word) for word in input().split()]',
    'print(" ".join(map(str, insertion_sort(items))))',
  ),
};

const JAVASCRIPT: Partial<Record<ExampleName, string>> = {
  hello: 'console.log("Hello, world!");\n',
  input: 'const name = readline();\nconsole.log(`Hello, ${name}!`);\n',
  functions: lines(
    'function gcd(a, b) {',
    '  while (b !== 0) {',
    '    [a, b] = [b, a % b];',
    '  }',
    '  return a;',
    '}',
    '',
    'const [a, b] = readline().split(" ").map(Number);',
    'console.log(gcd(a, b));',
  ),
  classes: lines(
    'class Stack {',
    '  #items = [];',
    '  push(item) {',
    '    this.#items.push(item);',
    '  }',
    '  pop() {',
    '    return this.#items.pop();',
    '  }',
    '  get size() {',
    '    return this.#items.length;',
    '  }',
    '}',
    '',
    'const stack = new Stack();',
    'for (const word of readline().split(" ")) stack.push(word);',
    'const out = [];',
    'while (stack.size > 0) out.push(stack.pop());',
    'console.log(out.join(" "));',
  ),
  binarySearch: lines(
    'function binarySearch(items, target) {',
    '  let low = 0;',
    '  let high = items.length - 1;',
    '  while (low <= high) {',
    '    const middle = Math.floor((low + high) / 2);',
    '    if (items[middle] === target) return middle;',
    '    if (items[middle] < target) low = middle + 1;',
    '    else high = middle - 1;',
    '  }',
    '  return -1;',
    '}',
    '',
    'const items = readline().split(" ").map(Number);',
    'console.log(binarySearch(items, Number(readline())));',
  ),
  bfs: lines(
    'const [n, m] = readline().split(" ").map(Number);',
    'const neighbors = Array.from({ length: n }, () => []);',
    'for (let i = 0; i < m; i += 1) {',
    '  const [u, v] = readline().split(" ").map(Number);',
    '  neighbors[u].push(v);',
    '  neighbors[v].push(u);',
    '}',
    'const start = Number(readline());',
    'const seen = new Set([start]);',
    'const order = [];',
    'const queue = [start];',
    'while (queue.length > 0) {',
    '  const node = queue.shift();',
    '  order.push(node);',
    '  for (const next of [...neighbors[node]].sort((a, b) => a - b)) {',
    '    if (!seen.has(next)) {',
    '      seen.add(next);',
    '      queue.push(next);',
    '    }',
    '  }',
    '}',
    'console.log(order.join(" "));',
  ),
  sorting: lines(
    'function insertionSort(items) {',
    '  for (let i = 1; i < items.length; i += 1) {',
    '    const key = items[i];',
    '    let j = i - 1;',
    '    while (j >= 0 && items[j] > key) {',
    '      items[j + 1] = items[j];',
    '      j -= 1;',
    '    }',
    '    items[j + 1] = key;',
    '  }',
    '  return items;',
    '}',
    '',
    'console.log(insertionSort(readline().split(" ").map(Number)).join(" "));',
  ),
};

const TYPESCRIPT: Partial<Record<ExampleName, string>> = {
  hello: 'const greeting: string = "Hello, world!";\nconsole.log(greeting);\n',
  functions: lines(
    'function gcd(a: number, b: number): number {',
    '  while (b !== 0) {',
    '    [a, b] = [b, a % b];',
    '  }',
    '  return a;',
    '}',
    '',
    'const [a, b] = (readline() ?? "").split(" ").map(Number);',
    'console.log(gcd(a, b));',
  ),
  binarySearch: lines(
    'function binarySearch(items: number[], target: number): number {',
    '  let low = 0;',
    '  let high = items.length - 1;',
    '  while (low <= high) {',
    '    const middle = Math.floor((low + high) / 2);',
    '    if (items[middle] === target) return middle;',
    '    if (items[middle] < target) low = middle + 1;',
    '    else high = middle - 1;',
    '  }',
    '  return -1;',
    '}',
    '',
    'const items = (readline() ?? "").split(" ").map(Number);',
    'console.log(binarySearch(items, Number(readline())));',
  ),
};

const LUA: Partial<Record<ExampleName, string>> = {
  hello: 'print("Hello, world!")\n',
  input: 'local name = io.read("l")\nprint("Hello, " .. name .. "!")\n',
  binarySearch: lines(
    'local function binary_search(items, target)',
    '  local low, high = 1, #items',
    '  while low <= high do',
    '    local middle = (low + high) // 2',
    '    if items[middle] == target then',
    '      return middle - 1',
    '    elseif items[middle] < target then',
    '      low = middle + 1',
    '    else',
    '      high = middle - 1',
    '    end',
    '  end',
    '  return -1',
    'end',
    '',
    'local items = {}',
    'for word in io.read("l"):gmatch("%S+") do',
    '  items[#items + 1] = tonumber(word)',
    'end',
    'print(binary_search(items, tonumber(io.read("l"))))',
  ),
};

const C: Partial<Record<ExampleName, string>> = {
  hello: lines('#include <stdio.h>', '', 'int main(void) {', '    printf("Hello, world!\\n");', '    return 0;', '}'),
  input: lines(
    '#include <stdio.h>',
    '',
    'int main(void) {',
    '    char name[100];',
    '    if (scanf("%99s", name) == 1) {',
    '        printf("Hello, %s!\\n", name);',
    '    }',
    '    return 0;',
    '}',
  ),
  binarySearch: lines(
    '#include <stdio.h>',
    '',
    'static int binary_search(const int *items, int count, int target) {',
    '    int low = 0, high = count - 1;',
    '    while (low <= high) {',
    '        int middle = low + (high - low) / 2;',
    '        if (items[middle] == target) return middle;',
    '        if (items[middle] < target) low = middle + 1;',
    '        else high = middle - 1;',
    '    }',
    '    return -1;',
    '}',
    '',
    'int main(void) {',
    '    int items[100], count = 0, target;',
    '    char line[1024];',
    '    if (!fgets(line, sizeof line, stdin)) return 1;',
    '    for (char *at = line; count < 100;) {',
    '        int value, used;',
    '        if (sscanf(at, "%d%n", &value, &used) != 1) break;',
    '        items[count++] = value;',
    '        at += used;',
    '    }',
    '    if (scanf("%d", &target) != 1) return 1;',
    '    printf("%d\\n", binary_search(items, count, target));',
    '    return 0;',
    '}',
  ),
  sorting: lines(
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '',
    'static int compare(const void *a, const void *b) {',
    '    int x = *(const int *)a, y = *(const int *)b;',
    '    return (x > y) - (x < y);',
    '}',
    '',
    'int main(void) {',
    '    int items[100], count = 0;',
    '    while (count < 100 && scanf("%d", &items[count]) == 1) count++;',
    '    qsort(items, count, sizeof items[0], compare);',
    '    for (int i = 0; i < count; i++) printf(i ? " %d" : "%d", items[i]);',
    '    printf("\\n");',
    '    return 0;',
    '}',
  ),
};

const CPP: Partial<Record<ExampleName, string>> = {
  hello: lines('#include <iostream>', '', 'int main() {', '    std::cout << "Hello, world!\\n";', '    return 0;', '}'),
  input: lines(
    '#include <iostream>',
    '#include <string>',
    '',
    'int main() {',
    '    std::string name;',
    '    std::getline(std::cin, name);',
    '    std::cout << "Hello, " << name << "!\\n";',
    '    return 0;',
    '}',
  ),
  binarySearch: lines(
    '#include <iostream>',
    '#include <sstream>',
    '#include <string>',
    '#include <vector>',
    '',
    'int binarySearch(const std::vector<int>& items, int target) {',
    '    int low = 0, high = static_cast<int>(items.size()) - 1;',
    '    while (low <= high) {',
    '        int middle = low + (high - low) / 2;',
    '        if (items[middle] == target) return middle;',
    '        if (items[middle] < target) low = middle + 1;',
    '        else high = middle - 1;',
    '    }',
    '    return -1;',
    '}',
    '',
    'int main() {',
    '    std::string line;',
    '    std::getline(std::cin, line);',
    '    std::istringstream words(line);',
    '    std::vector<int> items;',
    '    for (int value; words >> value;) items.push_back(value);',
    '    int target = 0;',
    '    std::cin >> target;',
    '    std::cout << binarySearch(items, target) << "\\n";',
    '    return 0;',
    '}',
  ),
  bfs: lines(
    '#include <algorithm>',
    '#include <iostream>',
    '#include <queue>',
    '#include <vector>',
    '',
    'int main() {',
    '    int n = 0, m = 0;',
    '    std::cin >> n >> m;',
    '    std::vector<std::vector<int>> neighbors(n);',
    '    for (int i = 0; i < m; ++i) {',
    '        int u = 0, v = 0;',
    '        std::cin >> u >> v;',
    '        neighbors[u].push_back(v);',
    '        neighbors[v].push_back(u);',
    '    }',
    '    int start = 0;',
    '    std::cin >> start;',
    '    std::vector<bool> seen(n, false);',
    '    std::queue<int> queue;',
    '    queue.push(start);',
    '    seen[start] = true;',
    '    bool first = true;',
    '    while (!queue.empty()) {',
    '        int node = queue.front();',
    '        queue.pop();',
    '        std::cout << (first ? "" : " ") << node;',
    '        first = false;',
    '        std::sort(neighbors[node].begin(), neighbors[node].end());',
    '        for (int next : neighbors[node]) {',
    '            if (!seen[next]) {',
    '                seen[next] = true;',
    '                queue.push(next);',
    '            }',
    '        }',
    '    }',
    '    std::cout << "\\n";',
    '    return 0;',
    '}',
  ),
  sorting: lines(
    '#include <algorithm>',
    '#include <iostream>',
    '#include <vector>',
    '',
    'int main() {',
    '    std::vector<int> items;',
    '    for (int value; std::cin >> value;) items.push_back(value);',
    '    std::sort(items.begin(), items.end());',
    '    for (std::size_t i = 0; i < items.size(); ++i) std::cout << (i ? " " : "") << items[i];',
    '    std::cout << "\\n";',
    '    return 0;',
    '}',
  ),
};

const SCHEMA = lines(
  'CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER);',
  'CREATE TABLE courses (id INTEGER PRIMARY KEY, title TEXT NOT NULL);',
  'CREATE TABLE enrollments (person INTEGER REFERENCES people(id), course INTEGER REFERENCES courses(id));',
  '',
  "INSERT INTO people VALUES (1, 'Ada', 36), (2, 'Grace', 45), (3, 'Alan', 17), (4, 'Edsger', 28);",
  "INSERT INTO courses VALUES (1, 'Algorithms'), (2, 'Databases');",
  'INSERT INTO enrollments VALUES (1, 1), (2, 1), (2, 2), (4, 2);',
);

const SQL: Partial<Record<ExampleName, { query: string; test: TestCase }>> = {
  sqlSelect: {
    query: 'SELECT name, age\nFROM people\nWHERE age >= 18\nORDER BY age DESC;\n',
    test: sql(
      'sqlSelect',
      ['name', 'age'],
      [
        ['Grace', 45],
        ['Ada', 36],
        ['Edsger', 28],
      ],
    ),
  },
  sqlJoin: {
    query: lines(
      'SELECT people.name, courses.title',
      'FROM enrollments',
      'JOIN people ON people.id = enrollments.person',
      'JOIN courses ON courses.id = enrollments.course',
      'ORDER BY courses.title, people.name;',
    ),
    test: sql(
      'sqlJoin',
      ['name', 'title'],
      [
        ['Ada', 'Algorithms'],
        ['Grace', 'Algorithms'],
        ['Edsger', 'Databases'],
        ['Grace', 'Databases'],
      ],
    ),
  },
  sqlGroup: {
    query: lines(
      'SELECT courses.title, COUNT(*) AS students',
      'FROM enrollments',
      'JOIN courses ON courses.id = enrollments.course',
      'GROUP BY courses.title',
      'ORDER BY courses.title;',
    ),
    test: sql(
      'sqlGroup',
      ['title', 'students'],
      [
        ['Algorithms', 2],
        ['Databases', 2],
      ],
    ),
  },
};

const ENTRY_STEMS: Record<ExampleName, string> = {
  hello: 'hello',
  input: 'read_input',
  loops: 'loops',
  functions: 'functions',
  classes: 'classes',
  readFile: 'read_file',
  binarySearch: 'binary_search',
  bfs: 'bfs',
  sorting: 'sorting',
  sqlSelect: 'select',
  sqlJoin: 'join',
  sqlGroup: 'group_by',
};

const EXTENSIONS: Partial<Record<ProjectLanguage, string>> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  lua: 'lua',
  c: 'c',
  cpp: 'cpp',
  sql: 'sql',
};

function build(language: ProjectLanguage, programs: Partial<Record<ExampleName, string>>): Example[] {
  return (Object.entries(programs) as [ExampleName, string][]).map(([name, text]) => {
    const entry = `${ENTRY_STEMS[name]}.${EXTENSIONS[language]}`;
    const files: Record<string, string> = { [entry]: text };
    if (name === 'readFile') files['data.txt'] = '3\n5\n8\n';
    return { id: `${language}.${name}`, language, name, kind: KINDS[name], entry, files, tests: STANDARD_TESTS[name]! };
  });
}

const SQL_EXAMPLES: Example[] = (Object.entries(SQL) as [ExampleName, { query: string; test: TestCase }][]).map(
  ([name, { query, test }]) => {
    const entry = `${ENTRY_STEMS[name]}.sql`;
    return {
      id: `sql.${name}`,
      language: 'sql',
      name,
      kind: 'sql',
      entry,
      files: { 'schema.sql': SCHEMA, [entry]: query },
      tests: [test],
    };
  },
);

export const EXAMPLES: readonly Example[] = [
  ...build('python', PYTHON),
  ...build('javascript', JAVASCRIPT),
  ...build('typescript', TYPESCRIPT),
  ...build('lua', LUA),
  ...build('c', C),
  ...build('cpp', CPP),
  ...SQL_EXAMPLES,
];

/** A language's examples, starters first. */
export function examplesFor(language: ProjectLanguage): Example[] {
  const rank: Record<ExampleKind, number> = { starter: 0, algorithm: 1, sql: 2 };
  return EXAMPLES.filter((example) => example.language === language).sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** The hello example's program, the text of a new project's main file. */
export function helloText(language: ProjectLanguage): string | null {
  const example = EXAMPLES.find((one) => one.language === language && one.name === 'hello');
  return example ? example.files[example.entry]! : null;
}
