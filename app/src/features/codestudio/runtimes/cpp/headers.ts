// Which standard header declares a name (DESIGN 7.1, the "#include the header" quick fix of lane code:L11). The C
// names follow the library clauses of ISO/IEC 9899:2018 (C17), section 7; the C++ names follow the header synopses
// of ISO/IEC 14882:2020 (C++20). Each name maps to the header whose synopsis declares it. A name several headers
// declare (NULL, size_t, abs) maps to the one a program most often wants, which also declares it.

import type { ClangLanguage } from './flags';

const C_GROUPS: Record<string, string> = {
  'stdio.h':
    'printf scanf fprintf fscanf sprintf snprintf sscanf vprintf vfprintf vsprintf vsnprintf puts putchar getchar ' +
    'fgets fputs fgetc fputc getc putc ungetc fopen freopen fclose fflush fread fwrite fseek ftell rewind feof ' +
    'ferror clearerr perror remove rename tmpfile setbuf setvbuf FILE EOF BUFSIZ stdin stdout stderr SEEK_SET ' +
    'SEEK_CUR SEEK_END',
  'stdlib.h':
    'malloc calloc realloc free aligned_alloc exit abort atexit quick_exit _Exit getenv system abs labs llabs div ' +
    'ldiv atoi atol atoll atof strtol strtoll strtoul strtoull strtod strtof strtold rand srand qsort bsearch ' +
    'EXIT_SUCCESS EXIT_FAILURE RAND_MAX MB_CUR_MAX',
  'string.h':
    'strlen strcpy strncpy strcat strncat strcmp strncmp strcoll strxfrm strchr strrchr strstr strspn strcspn ' +
    'strpbrk strtok strerror memcpy memmove memset memcmp memchr',
  'math.h':
    'sqrt cbrt pow exp exp2 expm1 log log10 log2 log1p sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh ' +
    'atanh floor ceil round lround llround trunc rint nearbyint fabs fmod remainder fmin fmax fma hypot copysign ' +
    'nan isnan isinf isfinite signbit frexp ldexp modf HUGE_VAL INFINITY NAN',
  'ctype.h':
    'isalpha isdigit isalnum isspace isupper islower ispunct isxdigit iscntrl isgraph isprint isblank toupper tolower',
  'stdbool.h': 'bool true false',
  'stdint.h':
    'int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t uintptr_t intmax_t uintmax_t ' +
    'INT8_MAX INT16_MAX INT32_MAX INT64_MAX INT8_MIN INT16_MIN INT32_MIN INT64_MIN UINT8_MAX UINT16_MAX UINT32_MAX ' +
    'UINT64_MAX SIZE_MAX INTMAX_MAX',
  'inttypes.h': 'PRId8 PRId16 PRId32 PRId64 PRIu8 PRIu16 PRIu32 PRIu64 PRIx32 PRIx64 SCNd32 SCNd64 imaxabs strtoimax',
  'limits.h':
    'CHAR_BIT CHAR_MIN CHAR_MAX SCHAR_MIN SCHAR_MAX UCHAR_MAX SHRT_MIN SHRT_MAX USHRT_MAX INT_MIN INT_MAX UINT_MAX ' +
    'LONG_MIN LONG_MAX ULONG_MAX LLONG_MIN LLONG_MAX ULLONG_MAX',
  'float.h': 'FLT_MAX FLT_MIN FLT_EPSILON FLT_DIG DBL_MAX DBL_MIN DBL_EPSILON DBL_DIG LDBL_MAX LDBL_MIN LDBL_EPSILON',
  'stddef.h': 'size_t ptrdiff_t max_align_t offsetof NULL',
  'assert.h': 'assert static_assert',
  'time.h': 'time clock difftime mktime localtime gmtime strftime asctime ctime time_t clock_t CLOCKS_PER_SEC timespec',
  'errno.h': 'errno EDOM ERANGE EILSEQ',
  'stdarg.h': 'va_list va_start va_arg va_end va_copy',
  'setjmp.h': 'setjmp longjmp jmp_buf',
  'signal.h': 'signal raise sig_atomic_t SIGABRT SIGINT SIGSEGV SIGTERM',
  'locale.h': 'setlocale localeconv LC_ALL',
  'wchar.h': 'wchar_t wprintf wscanf wcslen wcscpy wcscmp fwprintf',
};

const CPP_GROUPS: Record<string, string> = {
  iostream: 'cout cin cerr clog wcout wcin',
  ostream: 'endl ends flush ostream',
  istream: 'istream ws',
  ios: 'fixed scientific boolalpha noboolalpha hex dec oct showpoint left right ios_base',
  iomanip: 'setw setprecision setfill setbase quoted put_time get_time',
  sstream: 'stringstream istringstream ostringstream',
  fstream: 'fstream ifstream ofstream',
  string: 'string wstring u8string to_string stoi stol stoll stoul stoull stof stod stold getline char_traits',
  string_view: 'string_view',
  vector: 'vector',
  array: 'array',
  list: 'list',
  forward_list: 'forward_list',
  deque: 'deque',
  map: 'map multimap',
  set: 'set multiset',
  unordered_map: 'unordered_map unordered_multimap',
  unordered_set: 'unordered_set unordered_multiset',
  queue: 'queue priority_queue',
  stack: 'stack',
  bitset: 'bitset',
  span: 'span',
  utility: 'pair make_pair move forward swap exchange declval as_const integer_sequence index_sequence',
  tuple: 'tuple make_tuple tie tuple_size tuple_element forward_as_tuple apply',
  algorithm:
    'sort stable_sort partial_sort nth_element find find_if find_if_not count count_if reverse rotate min max ' +
    'minmax min_element max_element minmax_element clamp binary_search lower_bound upper_bound equal_range unique ' +
    'fill fill_n copy copy_if copy_n transform for_each all_of any_of none_of remove remove_if replace replace_if ' +
    'next_permutation prev_permutation shuffle merge includes set_union set_intersection set_difference ' +
    'lexicographical_compare mismatch equal search is_sorted generate',
  numeric: 'accumulate reduce iota inner_product partial_sum adjacent_difference gcd lcm midpoint transform_reduce',
  memory: 'unique_ptr shared_ptr weak_ptr make_unique make_shared allocator addressof',
  functional:
    'function bind ref cref reference_wrapper hash greater less greater_equal less_equal equal_to plus minus ' +
    'multiplies',
  optional: 'optional nullopt make_optional',
  variant: 'variant visit holds_alternative get_if monostate',
  any: 'any any_cast',
  iterator:
    'back_inserter front_inserter inserter distance advance next prev istream_iterator ostream_iterator ' +
    'reverse_iterator',
  limits: 'numeric_limits',
  random:
    'mt19937 mt19937_64 random_device default_random_engine minstd_rand uniform_int_distribution ' +
    'uniform_real_distribution normal_distribution bernoulli_distribution discrete_distribution',
  chrono: 'chrono',
  thread: 'thread jthread this_thread',
  mutex: 'mutex lock_guard unique_lock scoped_lock',
  atomic: 'atomic',
  regex: 'regex regex_match regex_search regex_replace smatch',
  stdexcept: 'runtime_error logic_error invalid_argument out_of_range length_error domain_error overflow_error',
  exception: 'exception terminate',
  initializer_list: 'initializer_list',
  type_traits: 'is_same is_integral enable_if conditional decay remove_reference is_same_v',
  complex: 'complex',
  valarray: 'valarray',
  numbers: 'numbers',
  format: 'format',
  cassert: 'assert',
};

/** Name to header. The table has no prototype, so names such as "toString" and "__proto__" are not found in it. */
function expand(groups: Record<string, string>): Record<string, string> {
  const table = Object.create(null) as Record<string, string>;
  for (const [header, names] of Object.entries(groups)) {
    for (const name of names.split(/\s+/)) if (name) table[name] = header;
  }
  return table;
}

/** Name to header for each language. A C++ program reaches the C library through <cname> headers. */
export const HEADER_HINTS: Readonly<Record<ClangLanguage, Readonly<Record<string, string>>>> = {
  c: expand(C_GROUPS),
  cpp: expand(CPP_GROUPS),
};

/** The C++ header for a C library header: <stdio.h> is <cstdio>. */
const cppFromC = (header: string) => `c${header.replace(/\.h$/, '')}`;

/** The header that declares `name` ("printf", "std::vector", "vector"), as written in #include, or null. */
export function headerFor(name: string, language: ClangLanguage): string | null {
  const bare = name.replace(/^(::)?std::/, '').replace(/^::/, '');
  if (language === 'cpp') {
    const own = HEADER_HINTS.cpp[bare];
    if (own) return `<${own}>`;
    const fromC = HEADER_HINTS.c[bare];
    if (!fromC || ['bool', 'true', 'false', 'static_assert'].includes(bare)) return null;
    return `<${cppFromC(fromC)}>`;
  }
  const header = HEADER_HINTS.c[bare];
  return header ? `<${header}>` : null;
}

/** clang's own note, which already names the header. */
const NOTE = /include the header <([^>]+)> or explicitly provide a declaration for '([^']+)'/;
/** clang's messages for a name it does not know; the table finds its header. */
const UNKNOWN = [
  /use of undeclared identifier '([^']+)'/,
  /no (?:member|template|type) named '([^']+)' in namespace 'std'/,
  /call to undeclared (?:library )?function '([^']+)'/,
  /unknown type name '([^']+)'/,
  /implicit declaration of function '([^']+)'/,
];

/** The header a clang message points to, with the name it is for, or null when it names no known header. */
export function includeHint(message: string, language: ClangLanguage): { name: string; header: string } | null {
  const note = NOTE.exec(message);
  if (note) return { name: note[2]!, header: `<${note[1]!}>` };
  for (const pattern of UNKNOWN) {
    const name = pattern.exec(message)?.[1];
    const qualified = name && /in namespace 'std'/.test(message) ? `std::${name}` : name;
    const header = qualified ? headerFor(qualified, language) : null;
    if (qualified && header) return { name: qualified, header };
  }
  return null;
}
