// The small tables the fixes read: modules a Python name may stand for, and the header each standard name comes
// from. Both follow the language references (the Python library index and the standard library headers).

/** Python names that stand for a standard module, or a well-known alias: name to the import line. */
export const PYTHON_IMPORTS: Readonly<Record<string, string>> = Object.fromEntries([
  ...(
    'math random sys os json re time datetime itertools collections string functools statistics decimal fractions ' +
    'copy heapq bisect csv pathlib typing dataclasses enum textwrap operator io subprocess threading logging argparse ' +
    'unittest array struct hashlib base64 secrets uuid shutil glob tempfile pprint abc contextlib asyncio queue'
  )
    .split(' ')
    .map((name) => [name, `import ${name}`]),
  ['np', 'import numpy as np'],
  ['numpy', 'import numpy as np'],
  ['pd', 'import pandas as pd'],
  ['pandas', 'import pandas as pd'],
  ['plt', 'import matplotlib.pyplot as plt'],
  ['sp', 'import scipy as sp'],
  ['sympy', 'import sympy'],
  ['sns', 'import seaborn as sns'],
]);

/** [C header, C++ header] for the names programs use most, from the C and C++ standard library references. */
const HEADER_ROWS: [string, string, string][] = [
  [
    'stdio.h',
    'cstdio',
    'printf scanf fprintf sprintf snprintf sscanf fopen fclose fgets fputs puts putchar getchar ' +
      'fread fwrite fscanf fflush perror remove rename',
  ],
  [
    'stdlib.h',
    'cstdlib',
    'malloc calloc realloc free exit abort atoi atof atol strtol strtod rand srand qsort bsearch system getenv abs labs',
  ],
  [
    'string.h',
    'cstring',
    'strlen strcpy strncpy strcat strncat strcmp strncmp strchr strrchr strstr memcpy memmove memset memcmp strtok strdup',
  ],
  [
    'math.h',
    'cmath',
    'sqrt pow sin cos tan asin acos atan atan2 exp log log10 log2 ceil floor fabs fmod round trunc hypot cbrt',
  ],
  ['ctype.h', 'cctype', 'isalpha isdigit isalnum isspace isupper islower ispunct toupper tolower'],
  ['time.h', 'ctime', 'time clock difftime localtime gmtime strftime mktime'],
  ['stdbool.h', 'stdbool.h', 'bool'],
  ['stdint.h', 'cstdint', 'int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t'],
  ['stddef.h', 'cstddef', 'size_t ptrdiff_t offsetof'],
  ['assert.h', 'cassert', 'assert'],
  ['limits.h', 'climits', 'INT_MAX INT_MIN UINT_MAX LONG_MAX LONG_MIN CHAR_BIT'],
];

const CPP_ROWS: [string, string][] = [
  ['iostream', 'cout cin cerr clog endl'],
  ['vector', 'vector'],
  ['string', 'string getline to_string stoi stod stol'],
  ['map', 'map multimap'],
  ['set', 'set multiset'],
  ['unordered_map', 'unordered_map'],
  ['unordered_set', 'unordered_set'],
  [
    'algorithm',
    'sort find reverse max min swap count unique lower_bound upper_bound binary_search min_element max_element',
  ],
  ['memory', 'unique_ptr shared_ptr make_unique make_shared'],
  ['iomanip', 'setw setprecision setfill'],
  ['sstream', 'stringstream istringstream ostringstream'],
  ['fstream', 'ifstream ofstream fstream'],
  ['queue', 'queue priority_queue'],
  ['stack', 'stack'],
  ['deque', 'deque'],
  ['list', 'list'],
  ['array', 'array'],
  ['utility', 'pair move make_pair'],
  ['functional', 'function'],
  ['numeric', 'accumulate iota gcd lcm'],
  ['cmath', 'sqrt pow'],
];

const C_HEADERS = new Map<string, string>();
const CPP_HEADERS = new Map<string, string>();
for (const [c, cpp, names] of HEADER_ROWS) {
  for (const name of names.split(' ')) {
    C_HEADERS.set(name, c);
    CPP_HEADERS.set(name, cpp);
  }
}
for (const [header, names] of CPP_ROWS) for (const name of names.split(' ')) CPP_HEADERS.set(`std::${name}`, header);
for (const [header, names] of CPP_ROWS)
  for (const name of names.split(' ')) if (!CPP_HEADERS.has(name)) CPP_HEADERS.set(name, header);

/** The header a standard name needs. In C++ a name may come with or without its `std::`. */
export function headerFor(name: string, language: 'c' | 'cpp'): string | undefined {
  return language === 'c' ? C_HEADERS.get(name) : (CPP_HEADERS.get(name) ?? CPP_HEADERS.get(`std::${name}`));
}

/** Lua's global names, for "did you mean". */
export const LUA_GLOBALS =
  'assert collectgarbage dofile error getmetatable ipairs load loadfile next pairs pcall print rawequal rawget rawlen ' +
  'rawset require select setmetatable tonumber tostring type xpcall string table math os io coroutine utf8 debug';

/** C library function names, for "did you mean" in C and C++. */
export const C_FUNCTIONS = [...C_HEADERS.keys()];
