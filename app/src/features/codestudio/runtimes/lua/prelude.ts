// The Lua code that runs before the program (DESIGN 2.1, 4.3, 4.4, 10): it replaces the parts of the standard
// library that touch the machine. The host passes nine functions in a table, the global __host, which this code
// removes. The code keeps them as local variables, out of the program's reach.
// Input comes from the prefilled or interactive standard input. Output goes to the console.
// Files come from the project. The calls that start programs or change the machine do not exist.
// A host function marked "async" is waited for with :await(),
// which works because the main program runs in a coroutine.

export const PRELUDE = String.raw`
local host = __host
__host = nil
local out, err, readLine, readRest, exit = host.out, host.err, host.line, host.rest, host.exit
local readFile, writeFile, messages = host.read, host.write, host.messages
local type, tostring, tonumber, error, select, setmetatable = type, tostring, tonumber, error, select, setmetatable
local concat, format = table.concat, string.format

-- Output.
local function text(args, count, sep)
  local parts = {}
  for i = 1, count do parts[i] = tostring(args[i]) end
  return concat(parts, sep)
end
function print(...) out(text({ ... }, select("#", ...), "\t") .. "\n") end
local function put(stream, fname, ...)
  local parts = {}
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    local kind = type(v)
    if kind ~= "string" and kind ~= "number" then
      error(format("bad argument #%d to '%s' (string expected, got %s)", i, fname, kind), 3)
    end
    parts[i] = tostring(v)
  end
  stream(concat(parts))
end

-- Standard input. Unread text waits in buf; every line in it ends with a newline.
local buf, ended = "", false
local function fill()
  if ended then return false end
  local l = readLine():await()
  if l == nil then ended = true return false end
  buf = buf .. l .. "\n"
  return true
end
local function takeLine(keep)
  while true do
    local i = buf:find("\n", 1, true)
    if i then
      local s = buf:sub(1, keep and i or i - 1)
      buf = buf:sub(i + 1)
      return s
    end
    if not fill() then return nil end
  end
end
local function takeNumber()
  while true do
    local s, e, word = buf:find("(%S+)")
    if s then
      buf = buf:sub(e + 1)
      return tonumber(word)
    end
    buf = ""
    if not fill() then return nil end
  end
end
local function takeAll()
  local rest = (not ended) and readRest() or nil
  ended = true
  local s = buf .. (rest or "")
  buf = ""
  return s
end
local function takeCount(n)
  if n == 0 then if buf == "" then fill() end return buf ~= "" and "" or nil end
  while #buf < n and fill() do end
  if #buf == 0 and n > 0 then return nil end
  local s = buf:sub(1, n)
  buf = buf:sub(n + 1)
  return s
end
local function readOne(fmt, index)
  if type(fmt) == "number" then return takeCount(fmt) end
  local f = tostring(fmt):gsub("^%*", ""):sub(1, 1)
  if f == "l" then return takeLine(false)
  elseif f == "L" then return takeLine(true)
  elseif f == "n" then return takeNumber()
  elseif f == "a" then return takeAll() end
  error(format(messages.formatBad, index), 3)
end
local function readMany(...)
  local n = select("#", ...)
  if n == 0 then return takeLine(false) end
  local results = {}
  for i = 1, n do
    local v = readOne((select(i, ...)), i)
    results[i] = v
    if v == nil then return table.unpack(results, 1, i) end
  end
  return table.unpack(results, 1, n)
end

-- Files: the project is read-only, and a written file goes to the overlay the run shows afterward.
local File = {}
File.__index = File
File.__name = "FILE*"
local function newFile(fields) return setmetatable(fields, File) end
function File:write(...)
  if self.closed then error(messages.closedFile, 2) end
  if self.sink then put(self.sink, "write", ...)
  elseif self.mode == "w" then
    local s = {}
    for i = 1, select("#", ...) do s[i] = tostring((select(i, ...))) end
    self.data = self.data .. concat(s)
  else return nil, messages.badFd, 9 end
  return self
end
function File:read(...)
  if self.closed then error(messages.closedFile, 2) end
  if self.stdin then return readMany(...) end
  local n = select("#", ...)
  local fmt = n == 0 and "l" or ...
  local data = self.data
  if self.pos > #data and not (fmt == "a" or fmt == "*a") then return nil end
  local f = type(fmt) == "number" and "n#" or tostring(fmt):gsub("^%*", ""):sub(1, 1)
  local s
  if f == "n#" then s = data:sub(self.pos, self.pos + fmt - 1); self.pos = self.pos + #s
  elseif f == "a" then s = data:sub(self.pos); self.pos = #data + 1
  elseif f == "l" or f == "L" then
    local i = data:find("\n", self.pos, true)
    local stop = i or #data
    s = data:sub(self.pos, f == "L" and stop or (i and i - 1 or stop))
    self.pos = stop + 1
  elseif f == "n" then
    local a, b, word = data:find("(%S+)", self.pos)
    if not a then self.pos = #data + 1 return nil end
    self.pos = b + 1
    return tonumber(word)
  else error(format(messages.formatBad, 1), 2) end
  return s
end
function File:lines(...)
  local formats = { ... }
  return function() return self:read(table.unpack(formats)) end
end
function File:flush() return self end
function File:setvbuf() return true end
function File:seek() return 0 end
function File:close()
  if self.closed then error(messages.closedFile, 2) end
  if self.mode == "w" and not self.sink then
    if not writeFile(self.path, self.data) then return nil, format(messages.notWritable, self.path), 1 end
  end
  self.closed = true
  return true
end
function File:__tostring() return self.closed and "file (closed)" or "file (0x0)" end
function File:__close() if not self.closed then self:close() end end

local stdin = newFile({ stdin = true })
local stdout = newFile({ sink = out })
local stderr = newFile({ sink = err })
io.stdin, io.stdout, io.stderr = stdin, stdout, stderr
function io.write(...) put(out, "write", ...) return stdout end
function io.read(...) return readMany(...) end
function io.output() return stdout end
function io.input() return stdin end
function io.type(v) if getmetatable(v) == File then return v.closed and "closed file" or "file" end return nil end
function io.close(f) return (f or stdout):close() end
function io.open(path, mode)
  mode = mode or "r"
  local m = mode:sub(1, 1)
  if m == "r" then
    local data = readFile(path)
    if data == nil then return nil, format(messages.noFile, path), 2 end
    return newFile({ path = path, mode = "r", data = data, pos = 1 })
  elseif m == "w" or m == "a" then
    local data = m == "a" and readFile(path) or ""
    return newFile({ path = path, mode = "w", data = data or "" })
  end
  error("bad argument #2 to 'open' (invalid mode)", 2)
end
function io.lines(path, ...)
  if path == nil then return stdin:lines(...) end
  local f, e = io.open(path, "r")
  if not f then error(e, 2) end
  return f:lines(...)
end

-- Modules and files from the project.
local function load_project(name, path)
  local source = readFile(path)
  if source == nil then return nil end
  local fn, e = load(source, "@" .. path, "t")
  if not fn then error(e, 0) end
  return fn
end
local function searcher(name)
  local base = name:gsub("%.", "/")
  for _, path in ipairs({ base .. ".lua", base .. "/init.lua" }) do
    local fn = load_project(name, path)
    if fn then return fn, path end
  end
  return format(messages.noModule, base .. ".lua")
end
package.searchers = { package.searchers[1], searcher }
package.path = "?.lua;?/init.lua"
package.cpath = ""
package.loadlib = nil
function dofile(path)
  local fn = load_project(path, path)
  if not fn then error(format(messages.noFile, tostring(path)), 2) end
  return fn()
end
function loadfile(path, mode, env)
  local source = readFile(path)
  if source == nil then return nil, format(messages.noFile, tostring(path)) end
  return load(source, "@" .. path, mode or "t", env)
end

-- The machine: no processes, no files outside the project, no environment.
io.popen, io.tmpfile = nil, nil
os.execute, os.remove, os.rename, os.tmpname = nil, nil, nil, nil
os.getenv = function() return nil end
os.exit = function(code)
  if code == nil or code == true then code = 0 elseif code == false then code = 1 end
  exit(code)
  error(messages.exit, 0)
end
debug.getregistry = nil

-- Binary chunks are not safe: Lua 5.4 does not verify bytecode, so a crafted chunk can read and write the memory of
-- the WebAssembly module. load takes text only, and string.dump does not exist, so the program cannot make one.
local rawload = load
function load(chunk, chunkname, mode, ...) return rawload(chunk, chunkname, "t", ...) end
string.dump = nil

-- A program's debug hook would replace the count hook that ends a program at its time limit, and Lua cannot chain
-- the two. So debug.sethook does nothing. (A slow call into C, such as a hard string.find pattern, never reaches
-- the hook either. The run host's hard timer is the backstop for that.)
function debug.sethook() end

-- A check without running: nil when the source loads, else the error text.
return function(source, name)
  local fn, e = load(source, "@" .. name, "t", {})
  if fn then return nil end
  return e
end
`;
