// The Python side of a run, the same text for MicroPython and CPython (Pyodide). The page writes the run's settings
// to RUN_FILE, runs RUN_SOURCE at the top level, and reads how the run ended from STATE_FILE.
//
// The program runs as `python main.py` would run it. Its `__name__` is "__main__". sys.argv holds the main path and
// the arguments. sys.path[0] is the main file's folder, and the working folder is the project's root. Standard
// input is the prefilled text; input() at its end raises EOFError and the run notes that the program wanted more. A
// traceback leaves out this file's own frames and shows project paths without the mount's root, so it reads like
// CPython's or MicroPython's own.

/** Where the project is mounted inside the runtime's in-memory file system. */
export const HOME = '/project';
/** The run's own files, outside the project. */
export const SCRATCH = '/opennote';
export const RUN_FILE = `${SCRATCH}/run.json`;
export const STATE_FILE = `${SCRATCH}/state.json`;
export const CHECK_FILE = `${SCRATCH}/check.json`;
export const CHECKED_FILE = `${SCRATCH}/checked.json`;

/** How the Python side says the run ended. `kind` is the exception's type name. */
export interface PythonState {
  status: 'ok' | 'error';
  exit: number;
  kind: string;
  wantedInput: boolean;
  /** True when the program failed before it ran: compile() itself gave up, as on a parser stack overflow. */
  compiling?: boolean;
}

/** What the compile() check found: nothing, or one error with the place CPython gives (MicroPython gives text). */
export interface PythonChecked {
  ok: boolean;
  kind?: string;
  text?: string;
  /** The error's own last line, for an error that has no frame to map. */
  message?: string;
  line?: number | null;
  column?: number | null;
}

// Shared helpers: frames of this file are "<exec>" (Pyodide's runPython) or "<stdin>" (MicroPython's).
// MicroPython's `import sys` gives the stand-in a run puts in sys.modules, so the real module is kept once.
const HELPERS =
  String.raw`
try:
    _ON_SYS
except NameError:
    import sys as _ON_SYS
_on_sys = _ON_SYS

_ON_WRAP = ('<exec>', '<stdin>', '<opennote>')

def _on_flush():
    for s in (_on_sys.stdout, _on_sys.stderr):
        try:
            s.flush()
        except Exception:
            pass

def _on_format(e, home):
    real = _on_sys
    if real.implementation.name == 'micropython':
        io, = _on_import('io')
        buf = io.StringIO()
        real.print_exception(e, buf)
        lines = [l for l in buf.getvalue().split('\n') if not any(('File "' + w + '"') in l for w in _ON_WRAP)]
        text = '\n'.join(lines)
    else:
        traceback, = _on_import('traceback')
        tb = e.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename in _ON_WRAP:
            tb = tb.tb_next
        text = ''.join(traceback.format_exception(type(e), e, tb))
    return text.replace('File "' + home + '/', 'File "')

def _on_import(*names):
    # Imports the runtime's own modules, never a project file of the same name. MicroPython lets a file override most
    # of its built-in modules, and the working folder and sys.path point at the project during and after a run, so
    # the project's folders leave the path for the import, and a project module of that name is forgotten.
    real = _on_sys
    home = '` +
  HOME +
  String.raw`'
    kept = list(real.path)
    real.path.clear()
    real.path.extend([p for p in kept if p not in ('', '.') and p != home and not p.startswith(home + '/')])
    try:
        found = []
        for name in names:
            mod = real.modules.get(name)
            f = getattr(mod, '__file__', None)
            if isinstance(f, str) and f.startswith(home + '/'):
                del real.modules[name]
            found.append(__import__(name))
        return found
    finally:
        real.path.clear()
        real.path.extend(kept)

def _on_read(path):
    f = open(path, 'rb')
    try:
        return f.read().decode('utf-8')
    finally:
        f.close()

def _on_write(path, text):
    f = open(path, 'w')
    try:
        f.write(text)
    finally:
        f.close()
`;

/** Runs one program. Safe to run again in the same runtime: it forgets the last run's project modules first. */
export const RUN_SOURCE =
  HELPERS +
  String.raw`
def _on_run():
    json, os, builtins, random = _on_import('json', 'os', 'builtins', 'random')
    real = _on_sys
    micro = real.implementation.name == 'micropython'
    cfg = json.loads(_on_read('` +
  RUN_FILE +
  String.raw`'))
    home = cfg['home']
    main = cfg['main']
    state = {'status': 'ok', 'exit': 0, 'kind': '', 'wantedInput': False}

    # A project module from an earlier run in this runtime is not reused.
    for name in list(real.modules):
        mod = real.modules[name]
        f = getattr(mod, '__file__', None)
        if isinstance(f, str) and f.startswith(home + '/'):
            del real.modules[name]
    if not micro:
        importlib, linecache = _on_import('importlib', 'linecache')
        importlib.invalidate_caches()
        linecache.clearcache()

    class Stdin:
        def __init__(self, text):
            self.text = text
            self.at = 0
        def read(self, size=-1):
            end = len(self.text) if size is None or size < 0 else min(len(self.text), self.at + size)
            piece = self.text[self.at:end]
            self.at = end
            return piece
        def readline(self, size=-1):
            i = self.text.find('\n', self.at)
            end = len(self.text) if i < 0 else i + 1
            if size is not None and size >= 0:
                end = min(end, self.at + size)
            piece = self.text[self.at:end]
            self.at = end
            return piece
        def readlines(self, hint=-1):
            return list(self)
        def __iter__(self):
            return self
        def __next__(self):
            line = self.readline()
            if line == '':
                raise StopIteration
            return line
        def isatty(self):
            return False
        def readable(self):
            return True
        def close(self):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    stdin = Stdin(cfg['stdin'])
    out = real.stdout

    def input(prompt=''):
        if prompt != '':
            out.write(str(prompt))
        line = stdin.readline()
        if line == '':
            state['wantedInput'] = True
            raise EOFError('EOF when reading a line')
        return line[:-1] if line.endswith('\n') else line

    builtins.input = input
    argv = [main] + list(cfg['args'])
    folder = home + '/' + main.rsplit('/', 1)[0] if '/' in main else home
    for entry in [p for p in real.path if p == home or p.startswith(home + '/')]:
        real.path.remove(entry)
    real.path.insert(0, folder)
    # The runner loaded these; a fresh "python main.py" would not have, so the program's own file of that name wins.
    for name in ('random', 'json'):
        try:
            os.stat(folder + '/' + name + '.py')
            real.modules.pop(name, None)
        except OSError:
            pass
    if micro:
        real.argv.clear()
        real.argv.extend(argv)
        class Sys:
            def __getattr__(self, name):
                return getattr(real, name)
        shown = Sys()
        shown.stdin = stdin
        real.modules['sys'] = shown
    else:
        real.argv = argv
        real.stdin = stdin
        try:
            real.stdout.reconfigure(line_buffering=True)
        except Exception:
            pass
    os.chdir(home)
    # A failed seed leaves the module's own seed; the run goes on.
    try:
        random.seed(cfg['seed'])
    except Exception:
        pass

    path = home + '/' + main
    scope = {'__name__': '__main__', '__file__': path, '__builtins__': builtins}
    if not micro:
        types, = _on_import('types')
        module = types.ModuleType('__main__')
        module.__file__ = path
        scope = module.__dict__
        real.modules['__main__'] = module
    state['compiling'] = True
    try:
        text = _on_read(path)
        if text.startswith('\ufeff'):
            text = text[1:]
        code = compile(text, main, 'exec')
        state['compiling'] = False
        exec(code, scope)
    except SystemExit as e:
        code = e.args[0] if len(e.args) > 0 else None
        # A bool is an int in CPython but not in MicroPython: test it first. A code past 32 bits is clamped, so the
        # page gets a number it accepts and a code that is not 0 stays not 0.
        if code is None:
            state['exit'] = 0
        elif code is True or code is False or isinstance(code, int):
            state['exit'] = max(-2147483648, min(2147483647, int(code)))
        else:
            _on_flush()
            real.stderr.write(str(code) + '\n')
            state['exit'] = 1
        if state['exit'] != 0:
            state['status'] = 'error'
            state['kind'] = 'SystemExit'
    except BaseException as e:
        _on_flush()
        real.stderr.write(_on_format(e, home))
        state['status'] = 'error'
        state['exit'] = 1
        state['kind'] = type(e).__name__
    _on_flush()
    _on_write('` +
  STATE_FILE +
  String.raw`', json.dumps(state))

_on_run()
`;

/** Compiles one file without running it (DESIGN 6.1, layer L-c) and writes what it found to CHECKED_FILE. */
export const CHECK_SOURCE =
  HELPERS +
  String.raw`
def _on_check():
    json, = _on_import('json')
    cfg = json.loads(_on_read('` +
  CHECK_FILE +
  String.raw`'))
    found = {'ok': True}
    text = cfg['text']
    # A byte order mark is not part of the program: a run strips it, so the check does too.
    if text.startswith('\ufeff'):
        text = text[1:]
    try:
        compile(text, cfg['path'], 'exec')
    except Exception as e:
        # MemoryError and RecursionError: the parser's own stack ran out, as it will in the run. MicroPython has no
        # RecursionError, so it is matched by name.
        if isinstance(e, (SyntaxError, MemoryError)) or type(e).__name__ == 'RecursionError':
            found = {
                'ok': False,
                'kind': type(e).__name__,
                'text': _on_format(e, cfg['home']),
                'message': type(e).__name__ + ': ' + str(getattr(e, 'msg', None) or e),
                'line': getattr(e, 'lineno', None),
                'column': getattr(e, 'offset', None),
            }
    _on_write('` +
  CHECKED_FILE +
  String.raw`', json.dumps(found))

_on_check()
`;
