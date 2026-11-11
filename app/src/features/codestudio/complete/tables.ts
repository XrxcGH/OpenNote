// Bundled tables for completion without a model (DESIGN 10.2): keywords and built-ins per language, and the members
// of common built-in types and modules. Each list is ordered from the most used to the least used, by our own
// estimate of everyday code; the order is the frequency the ranking reads. The names come from each language's
// reference documentation.

// prettier-ignore
const JS_KEYWORDS: readonly string[] = [
  'const', 'return', 'if', 'function', 'let', 'this', 'else', 'for', 'new', 'true', 'false', 'null', 'undefined',
  'of', 'import', 'export', 'await', 'async', 'class', 'while', 'typeof', 'break', 'continue', 'throw', 'try',
  'catch', 'finally', 'switch', 'case', 'default', 'in', 'instanceof', 'var', 'delete', 'do', 'extends', 'super',
  'static', 'yield', 'void',
];

/** Keywords per language, most used first. */
// prettier-ignore
export const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  python: [
    'def', 'return', 'if', 'for', 'in', 'import', 'else', 'elif', 'self', 'None', 'True', 'False', 'and', 'not',
    'from', 'class', 'while', 'or', 'is', 'try', 'except', 'with', 'as', 'break', 'continue', 'pass', 'lambda',
    'raise', 'finally', 'yield', 'global', 'nonlocal', 'assert', 'del', 'async', 'await',
  ],
  javascript: JS_KEYWORDS,
  typescript: [...JS_KEYWORDS, 'interface', 'type', 'enum', 'implements', 'readonly', 'keyof', 'as'],
  c: [
    'int', 'return', 'if', 'for', 'char', 'void', 'else', 'while', 'const', 'struct', 'unsigned', 'double', 'float',
    'long', 'sizeof', 'static', 'break', 'case', 'switch', 'default', 'continue', 'typedef', 'NULL', 'enum', 'short',
    'do', 'goto', 'signed', 'extern', 'union', 'volatile', 'bool', 'true', 'false',
  ],
  cpp: [
    'int', 'return', 'if', 'for', 'auto', 'const', 'std', 'void', 'else', 'while', 'char', 'double', 'bool', 'true',
    'false', 'class', 'struct', 'public', 'private', 'nullptr', 'new', 'delete', 'this', 'using', 'namespace',
    'template', 'typename', 'static', 'break', 'continue', 'switch', 'case', 'default', 'float', 'long', 'unsigned',
    'virtual', 'override', 'protected', 'try', 'catch', 'throw', 'enum', 'sizeof', 'constexpr', 'do',
  ],
  java: [
    'public', 'return', 'if', 'int', 'new', 'private', 'void', 'static', 'final', 'for', 'else', 'this', 'class',
    'String', 'boolean', 'null', 'true', 'false', 'import', 'while', 'double', 'try', 'catch', 'throw', 'throws',
    'extends', 'implements', 'interface', 'break', 'continue', 'switch', 'case', 'default', 'long', 'char',
    'protected', 'package', 'super', 'instanceof', 'abstract', 'finally', 'do', 'enum', 'var',
  ],
  sql: [
    'SELECT', 'FROM', 'WHERE', 'AND', 'JOIN', 'ON', 'AS', 'ORDER', 'BY', 'GROUP', 'INSERT', 'INTO', 'VALUES',
    'UPDATE', 'SET', 'DELETE', 'LEFT', 'INNER', 'NOT', 'NULL', 'IS', 'OR', 'IN', 'LIKE', 'LIMIT', 'DISTINCT',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'HAVING', 'CREATE', 'TABLE', 'PRIMARY', 'KEY', 'INTEGER', 'TEXT', 'DESC',
    'ASC', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'EXISTS', 'DROP', 'ALTER',
  ],
  lua: [
    'local', 'end', 'function', 'if', 'then', 'return', 'for', 'do', 'else', 'nil', 'in', 'true', 'false', 'and',
    'not', 'or', 'elseif', 'while', 'break', 'repeat', 'until', 'goto',
  ],
  go: [
    'func', 'return', 'if', 'err', 'nil', 'for', 'range', 'var', 'string', 'int', 'type', 'struct', 'package',
    'import', 'else', 'true', 'false', 'break', 'continue', 'switch', 'case', 'default', 'go', 'defer', 'map',
    'chan', 'select', 'const', 'interface',
  ],
  rust: [
    'let', 'fn', 'mut', 'self', 'if', 'return', 'pub', 'impl', 'use', 'match', 'for', 'in', 'Some', 'None', 'Ok',
    'Err', 'else', 'struct', 'enum', 'mod', 'true', 'false', 'while', 'loop', 'break', 'continue', 'const', 'static',
    'trait', 'where', 'as', 'move', 'ref', 'crate', 'super', 'unsafe', 'async', 'await', 'dyn', 'type',
  ],
};

// prettier-ignore
const JS_BUILTINS: readonly string[] = [
  'console', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Promise', 'Map', 'Set', 'Date', 'Error',
  'parseInt', 'parseFloat', 'setTimeout', 'Boolean', 'RegExp', 'isNaN', 'clearTimeout', 'setInterval', 'Symbol',
  'BigInt', 'globalThis',
];

/** Built-in functions and types per language, most used first. */
// prettier-ignore
export const BUILTINS: Readonly<Record<string, readonly string[]>> = {
  python: [
    'print', 'len', 'range', 'int', 'str', 'list', 'input', 'dict', 'float', 'enumerate', 'sum', 'max', 'min',
    'sorted', 'abs', 'open', 'zip', 'set', 'isinstance', 'map', 'round', 'tuple', 'bool', 'type', 'any', 'all',
    'reversed', 'filter', 'super', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'ord', 'chr',
    'hasattr', 'getattr', 'setattr', 'iter', 'next', 'pow', 'divmod', 'hex', 'bin', 'format', 'repr', 'id', 'hash',
  ],
  javascript: JS_BUILTINS,
  typescript: [...JS_BUILTINS, 'Record', 'Partial', 'Readonly', 'string', 'number', 'boolean'],
  c: [
    'printf', 'scanf', 'malloc', 'free', 'strlen', 'size_t', 'main', 'fprintf', 'memset', 'strcmp', 'strcpy', 'puts',
    'calloc', 'realloc', 'memcpy', 'fgets', 'sprintf', 'exit', 'abs', 'sqrt', 'pow', 'stdout', 'stderr', 'stdin',
  ],
  cpp: [
    'cout', 'endl', 'vector', 'string', 'cin', 'size_t', 'main', 'map', 'pair', 'make_pair', 'sort', 'min', 'max',
    'unordered_map', 'set', 'swap', 'push_back', 'unique_ptr', 'make_unique', 'shared_ptr', 'move', 'begin', 'end',
    'abs', 'cerr', 'getline', 'to_string', 'stoi', 'printf',
  ],
  java: [
    'System', 'String', 'Integer', 'List', 'ArrayList', 'Math', 'Map', 'HashMap', 'Scanner', 'Object', 'Override',
    'Exception', 'Arrays', 'Double', 'Set', 'HashSet', 'StringBuilder', 'Collections', 'Long', 'Boolean',
  ],
  lua: [
    'print', 'pairs', 'ipairs', 'table', 'string', 'tostring', 'tonumber', 'type', 'math', 'require', 'error',
    'pcall', 'select', 'setmetatable', 'assert', 'io', 'os',
  ],
  go: ['fmt', 'len', 'make', 'append', 'error', 'bool', 'byte', 'cap', 'copy', 'delete', 'panic', 'float64', 'rune'],
  rust: [
    'println', 'String', 'Vec', 'Option', 'Result', 'Box', 'format', 'vec', 'usize', 'i32', 'u8', 'i64', 'f64',
    'bool', 'str', 'HashMap', 'Self', 'clone', 'unwrap',
  ],
};

/** Members of built-in types, most used first. Keys are `language:type`. */
// prettier-ignore
export const TYPE_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  'python:list': ['append', 'extend', 'pop', 'sort', 'insert', 'index', 'remove', 'reverse', 'count', 'copy', 'clear'],
  'python:str': [
    'join', 'split', 'strip', 'replace', 'format', 'lower', 'upper', 'startswith', 'endswith', 'find', 'encode',
    'isdigit', 'rstrip', 'lstrip', 'splitlines', 'count', 'title', 'isalpha', 'index', 'capitalize', 'zfill',
    'center', 'ljust', 'rjust', 'isspace', 'isupper', 'islower', 'partition', 'swapcase',
  ],
  'python:dict': ['get', 'items', 'keys', 'values', 'update', 'pop', 'setdefault', 'copy', 'clear', 'popitem'],
  'python:set': [
    'add', 'remove', 'discard', 'union', 'intersection', 'difference', 'update', 'pop', 'issubset', 'issuperset',
    'symmetric_difference', 'clear', 'copy', 'isdisjoint',
  ],
  'javascript:Array': [
    'push', 'length', 'map', 'filter', 'forEach', 'join', 'slice', 'indexOf', 'includes', 'reduce', 'find', 'pop',
    'splice', 'concat', 'sort', 'some', 'every', 'shift', 'unshift', 'reverse', 'findIndex', 'flat', 'flatMap',
    'fill', 'at', 'keys', 'values', 'entries', 'lastIndexOf',
  ],
  'javascript:String': [
    'length', 'split', 'replace', 'trim', 'slice', 'indexOf', 'includes', 'toLowerCase', 'toUpperCase', 'startsWith',
    'endsWith', 'substring', 'charAt', 'padStart', 'match', 'repeat', 'replaceAll', 'charCodeAt', 'padEnd',
    'trimStart', 'trimEnd', 'at', 'concat', 'lastIndexOf', 'search', 'localeCompare',
  ],
  'javascript:Map': ['get', 'set', 'has', 'delete', 'size', 'keys', 'values', 'entries', 'forEach', 'clear'],
  'javascript:Set': ['add', 'has', 'delete', 'size', 'values', 'forEach', 'clear', 'keys', 'entries'],
  'javascript:Object': [
    'keys', 'assign', 'entries', 'values', 'freeze', 'create', 'defineProperty', 'fromEntries', 'getPrototypeOf',
    'is', 'getOwnPropertyNames',
  ],
  'javascript:Math': [
    'floor', 'max', 'min', 'round', 'random', 'abs', 'ceil', 'sqrt', 'pow', 'PI', 'trunc', 'sign', 'log', 'sin',
    'cos', 'atan2', 'hypot', 'exp', 'log2', 'log10', 'tan', 'E',
  ],
  'javascript:JSON': ['stringify', 'parse'],
  'javascript:console': ['log', 'error', 'warn', 'info', 'debug', 'table', 'time', 'timeEnd', 'assert', 'group'],
  'cpp:vector': [
    'push_back', 'size', 'begin', 'end', 'empty', 'back', 'clear', 'emplace_back', 'pop_back', 'front', 'resize',
    'reserve', 'insert', 'erase', 'at', 'data', 'capacity', 'assign', 'swap',
  ],
  'cpp:string': [
    'size', 'length', 'substr', 'find', 'c_str', 'empty', 'push_back', 'append', 'begin', 'end', 'at', 'clear',
    'compare', 'replace', 'insert', 'erase', 'back', 'front', 'pop_back', 'rfind',
  ],
  'cpp:map': [
    'find', 'insert', 'count', 'size', 'begin', 'end', 'erase', 'empty', 'at', 'emplace', 'clear', 'contains',
    'lower_bound', 'upper_bound',
  ],
};

/** Members of well-known modules, most used first. Keys are `language:module`. */
// prettier-ignore
export const MODULE_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  'python:math': [
    'sqrt', 'pi', 'floor', 'ceil', 'pow', 'log', 'sin', 'cos', 'exp', 'inf', 'fabs', 'gcd', 'isclose', 'factorial',
    'tan', 'atan2', 'radians', 'degrees', 'e', 'hypot', 'log10', 'log2', 'isnan', 'comb', 'perm', 'prod', 'trunc',
  ],
  'python:random': [
    'randint', 'random', 'choice', 'shuffle', 'seed', 'uniform', 'sample', 'choices', 'randrange', 'gauss',
  ],
  'python:os.path': [
    'join', 'exists', 'basename', 'dirname', 'isfile', 'isdir', 'splitext', 'abspath', 'getsize', 'split',
    'expanduser', 'relpath', 'normpath',
  ],
  'python:os': ['path', 'listdir', 'getcwd', 'makedirs', 'environ', 'remove', 'mkdir', 'walk', 'rename', 'sep'],
};

/** Which language family a table key uses. TypeScript reads JavaScript's members, C++'s tables serve C++ only. */
export function family(language: string): string {
  return language === 'typescript' ? 'javascript' : language;
}
