// Generated call harnesses (DESIGN 9.1): the source that calls a function with JSON arguments and prints its
// return value as one JSON line. A harness never changes the user's file: Python runs it as its own main file that
// executes the user's file under another module name (so no `if __name__ == "__main__"` block runs and line
// numbers stay the same); JavaScript, TypeScript, and Lua append it after the file's text.
import type { RuntimeId } from '../contracts';

/** A line that starts with this marker carries a result. Everything else a program prints is shown as usual. */
export const CALL_MARKER = '@@OPENNOTE-CALL@@';

export const HARNESS_FILE = '__opennote_test__';

/** The runtimes that can run a `call` case. */
export const CALL_RUNTIMES: readonly string[] = ['python-quick', 'python-full', 'javascript', 'typescript', 'lua'];

/** A name a person may call: letters, digits, and underscores, or a dotted path of them (`Solution.twoSum`). */
export const isCallable = (name: string) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name);

/** The argument list in JSON text, or null when the text is not a JSON array. An empty text is no arguments. */
export function parseCallArgs(text: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(text.trim() === '' ? '[]' : text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** The last output line that carries a result, without its marker; null when there is none. */
export function lastCallResult(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(CALL_MARKER));
  const last = lines.at(-1);
  return last === undefined ? null : last.slice(CALL_MARKER.length);
}

const literal = (text: string) => JSON.stringify(text);

/** The Lua long string that holds `text`, with enough `=` that the text cannot close it. */
function luaLong(text: string): string {
  let level = '';
  while (text.includes(`]${level}]`)) level += '=';
  // A space before the closing bracket, so a text that ends in "]" does not close the string early.
  return `[${level}[${text} ]${level}]`;
}

/** Python helpers kept to what MicroPython and CPython both have. */
const PYTHON_COMMON = `import json as _on_json


def _on_plain(v):
    if isinstance(v, dict):
        return {str(k): _on_plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)) or type(v).__name__ in ('set', 'frozenset'):
        return [_on_plain(x) for x in v]
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return None
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    return str(v)

`;

/** Python that runs the user's file under the name `opennote_user` and leaves its names in `_on_scope`. */
export function pythonLoad(file: string): string {
  return `_on_source = open(${literal(file)}).read()
_on_scope = {'__name__': 'opennote_user', '__file__': ${literal(file)}}
exec(compile(_on_source, ${literal(file)}, 'exec'), _on_scope)
`;
}

function pythonHarness(file: string, fn: string, argsJson: string): string {
  const [first, ...rest] = fn.split('.');
  return `${PYTHON_COMMON}${pythonLoad(file)}_on_fn = _on_scope[${literal(first!)}]
${rest.map((part) => `_on_fn = getattr(_on_fn, ${literal(part)})\n`).join('')}_on_result = _on_fn(*_on_json.loads(${literal(argsJson)}))
print(${literal(CALL_MARKER)} + _on_json.dumps(_on_plain(_on_result)))
`;
}

function javascriptHarness(fn: string, argsJson: string): string {
  return `
{
  const __on_args = JSON.parse(${literal(argsJson)});
  const __on_result = (${fn})(...__on_args);
  const __on_json = JSON.stringify(__on_result === undefined ? null : __on_result);
  console.log(${literal(CALL_MARKER)} + __on_json);
}
`;
}

// A JSON reader and writer in Lua 5.3 and later. A JSON null inside a list or a table is the table `__on_null`; a
// null argument is nil. An empty table, or one with the keys 1 to n only, is a list; any other table is an object.
const LUA_JSON = `
local __on_null = {}
local __on_enc
__on_enc = function(v, out)
  local t = type(v)
  if v == nil or v == __on_null then
    out[#out + 1] = 'null'
  elseif t == 'boolean' then
    out[#out + 1] = tostring(v)
  elseif t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then
      out[#out + 1] = 'null'
    elseif v == math.floor(v) and math.abs(v) < 1e15 then
      out[#out + 1] = string.format('%d', v)
    else
      local s
      for p = 15, 17 do
        s = string.format('%.' .. p .. 'g', v)
        if tonumber(s) == v then break end
      end
      out[#out + 1] = s
    end
  elseif t == 'string' then
    local map = { ['"'] = '\\\\"', ['\\\\'] = '\\\\\\\\', ['\\\\n'] = '\\\\n', ['\\\\r'] = '\\\\r', ['\\\\t'] = '\\\\t' }
    out[#out + 1] = '"' .. string.gsub(v, '[%c"\\\\\\\\]', function(c)
      return map[c] or string.format('\\\\u%04x', string.byte(c))
    end) .. '"'
  elseif t == 'table' then
    local n, count = #v, 0
    for _ in pairs(v) do count = count + 1 end
    if count == n then
      out[#out + 1] = '['
      for i = 1, n do
        if i > 1 then out[#out + 1] = ',' end
        __on_enc(v[i], out)
      end
      out[#out + 1] = ']'
    else
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = tostring(k) end
      table.sort(keys)
      out[#out + 1] = '{'
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = ',' end
        __on_enc(k, out)
        out[#out + 1] = ':'
        local item = v[k]
        if item == nil then item = v[tonumber(k)] end
        __on_enc(item, out)
      end
      out[#out + 1] = '}'
    end
  else
    __on_enc(tostring(v), out)
  end
end
local function __on_dec(s)
  local pos = 1
  local val
  local function ws() pos = string.find(s, '%S', pos) or #s + 1 end
  local escapes = { b = '\\b', f = '\\f', n = '\\n', r = '\\r', t = '\\t', ['"'] = '"', ['\\\\'] = '\\\\', ['/'] = '/' }
  local function str()
    local out = {}
    pos = pos + 1
    while true do
      local c = string.sub(s, pos, pos)
      if c == '"' then pos = pos + 1; return table.concat(out) end
      if c == '' then error('bad JSON text') end
      if c == '\\\\' then
        local n = string.sub(s, pos + 1, pos + 1)
        if n == 'u' then
          local code = tonumber(string.sub(s, pos + 2, pos + 5), 16)
          pos = pos + 6
          if code >= 0xD800 and code <= 0xDBFF and string.sub(s, pos, pos + 1) == '\\\\u' then
            local low = tonumber(string.sub(s, pos + 2, pos + 5), 16)
            pos = pos + 6
            code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
          end
          out[#out + 1] = utf8.char(code)
        else
          out[#out + 1] = escapes[n]
          pos = pos + 2
        end
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
  end
  val = function()
    ws()
    local c = string.sub(s, pos, pos)
    if c == '{' then
      local t = {}
      pos = pos + 1
      ws()
      if string.sub(s, pos, pos) == '}' then pos = pos + 1; return t end
      while true do
        ws()
        local k = str()
        ws()
        pos = pos + 1
        t[k] = val()
        ws()
        local d = string.sub(s, pos, pos)
        pos = pos + 1
        if d == '}' then return t end
      end
    elseif c == '[' then
      local t = {}
      pos = pos + 1
      ws()
      if string.sub(s, pos, pos) == ']' then pos = pos + 1; return t end
      while true do
        t[#t + 1] = val()
        ws()
        local d = string.sub(s, pos, pos)
        pos = pos + 1
        if d == ']' then return t end
      end
    elseif c == '"' then
      return str()
    elseif string.sub(s, pos, pos + 3) == 'true' then pos = pos + 4; return true
    elseif string.sub(s, pos, pos + 4) == 'false' then pos = pos + 5; return false
    elseif string.sub(s, pos, pos + 3) == 'null' then pos = pos + 4; return __on_null
    end
    local number = string.match(s, '^-?%d+%.?%d*[eE]?[+-]?%d*', pos)
    if not number then error('bad JSON text') end
    pos = pos + #number
    return tonumber(number)
  end
  return val()
end
`;

function luaHarness(fn: string, argsJson: string): string {
  return `
do
${LUA_JSON}
  local __on_args = __on_dec(${luaLong(argsJson)})
  local __on_n = #__on_args
  for i = 1, __on_n do
    if __on_args[i] == __on_null then __on_args[i] = nil end
  end
  local __on_result = (${fn})((table.unpack or unpack)(__on_args, 1, __on_n))
  local __on_out = {}
  __on_enc(__on_result, __on_out)
  print(${literal(CALL_MARKER)} .. table.concat(__on_out))
end
`;
}

export interface HarnessInput {
  runtime: string;
  /** The main file's path and text. */
  path: string;
  text: string;
  fn: string;
  /** The JSON text of the argument list. */
  callArgs: string;
}

export interface Harnessed {
  /** The text the main file runs with. Python leaves it as it is. */
  text: string;
  /** Python's harness is a file of its own, next to the main file, and becomes the main file. */
  extra?: { path: string; text: string };
}

/** The folder part of a path, with its closing slash ("" at the root). */
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/**
 * The files to run for one `call` case, or null when the language cannot run one, `fn` is not a name, or the
 * arguments are not a JSON list.
 */
export function buildCall(input: HarnessInput & { runtime: RuntimeId }): Harnessed | null {
  const args = parseCallArgs(input.callArgs);
  if (!args || !isCallable(input.fn)) return null;
  // The same JSON, normalized, so a quoted literal or a Lua long string never meets a stray character.
  const json = JSON.stringify(args);
  switch (input.runtime) {
    case 'python-quick':
    case 'python-full': {
      const folder = folderOf(input.path);
      return {
        text: input.text,
        extra: {
          path: `${folder}${HARNESS_FILE}.py`,
          text: pythonHarness(input.path, input.fn, json),
        },
      };
    }
    case 'javascript':
    case 'typescript':
      return { text: `${input.text}\n${javascriptHarness(input.fn, json)}` };
    case 'lua':
      return { text: `${input.text}\n${luaHarness(input.fn, json)}` };
    default:
      return null;
  }
}
