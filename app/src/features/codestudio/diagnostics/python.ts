// OpenNote's Python checker over the Lezer tree (layer L-b, DESIGN 6.1). The rule codes are the pyflakes and
// pycodestyle codes as Ruff documents them, so the marks read as people know them: F401 unused import, F811
// redefinition of an unused name, F821 undefined name, F841 unused local, E711 and E712 comparison to None, True, or
// False, F632 `is` with a literal, W191 tab indentation, and E101 mixed indentation. The scope rules follow Python's
// documented name resolution: module code runs in order, function bodies run later, and class bodies are not visible
// to the functions inside them.

import type { SyntaxNode, Tree } from '@lezer/common';
import { PYTHON_BUILTINS } from './pythonNames';
import { lineAt, lineStarts } from './text';
import type { Finding } from './types';

type ScopeKind = 'module' | 'class' | 'function' | 'comprehension';
type BindKind = 'import' | 'future' | 'def' | 'class' | 'assign' | 'param' | 'loop' | 'except' | 'other';

interface Scope {
  kind: ScopeKind;
  parent: Scope | null;
  bindings: Map<string, Binding[]>;
  globals: Set<string>;
  nonlocals: Set<string>;
  star: boolean;
  callsLocals: boolean;
}

interface Binding {
  name: string;
  /** What the message names: the dotted module for `import a.b`. */
  shown: string;
  from: number;
  to: number;
  /** Where the name becomes visible to code that runs in order. */
  at: number;
  kind: BindKind;
  /** A lone name target, the only kind F841 reports. */
  simple: boolean;
  /** The block that holds the statement, so F811 compares bindings of one block only. */
  block: number;
  decorators: string[];
  uses: number;
}

interface Ref {
  name: string;
  from: number;
  to: number;
  scope: Scope;
  /** The loops around the reference, so a name bound later in the same loop counts. */
  loops: [number, number][];
}

/** Ruff's default dummy-variable pattern: names F841 never reports. */
const DUMMY = /^(?:_+|_+[a-zA-Z0-9_]*[a-zA-Z0-9]+?)$/;
const COMPREHENSIONS = new Set([
  'ArrayComprehensionExpression',
  'SetComprehensionExpression',
  'DictionaryComprehensionExpression',
  'ComprehensionExpression',
]);
const LITERALS = new Set(['Number', 'String', 'FormatString', 'ContinuedString', 'Bytes']);

function kids(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

class PythonChecker {
  readonly findings: Finding[] = [];
  private readonly refs: Ref[] = [];
  private readonly scopes: Scope[] = [];
  private readonly exported = new Set<string>();
  private loops: [number, number][] = [];

  constructor(private readonly text: string) {}

  private slice(node: SyntaxNode): string {
    return this.text.slice(node.from, node.to);
  }

  private scope(kind: ScopeKind, parent: Scope | null): Scope {
    const s: Scope = {
      kind,
      parent,
      bindings: new Map(),
      globals: new Set(),
      nonlocals: new Set(),
      star: false,
      callsLocals: false,
    };
    this.scopes.push(s);
    return s;
  }

  private bind(
    scope: Scope,
    node: SyntaxNode,
    kind: BindKind,
    at: number,
    extra: Partial<Pick<Binding, 'shown' | 'simple' | 'decorators'>> = {},
  ): void {
    const name = this.slice(node);
    if (name === '_' && kind !== 'assign') return;
    let target = scope;
    if (scope.globals.has(name)) target = this.scopes[0];
    else if (scope.nonlocals.has(name)) target = this.enclosingWith(scope, name) ?? scope;
    while (target.kind === 'comprehension' && kind === 'other' && target.parent) target = target.parent;
    const binding: Binding = {
      name,
      shown: extra.shown ?? name,
      from: node.from,
      to: node.to,
      at: target === scope ? at : -1,
      kind,
      simple: extra.simple ?? false,
      block: this.block(node),
      decorators: extra.decorators ?? [],
      uses: 0,
    };
    const list = target.bindings.get(name);
    if (list) list.push(binding);
    else target.bindings.set(name, [binding]);
  }

  private enclosingWith(scope: Scope, name: string): Scope | null {
    for (let s = scope.parent; s; s = s.parent) if (s.kind === 'function' && s.bindings.has(name)) return s;
    return null;
  }

  /** The start of the statement list that holds `node`. */
  private block(node: SyntaxNode): number {
    for (let n: SyntaxNode | null = node.parent; n; n = n.parent) {
      if (n.name === 'Body' || n.name === 'Script') return n.from;
    }
    return 0;
  }

  private ref(scope: Scope, node: SyntaxNode): void {
    const name = this.slice(node);
    if (name === 'locals') scope.callsLocals = true;
    this.refs.push({ name, from: node.from, to: node.to, scope, loops: this.loops });
  }

  private statementEnd(node: SyntaxNode): number {
    let n = node;
    while (n.parent && n.parent.name !== 'Body' && n.parent.name !== 'Script') n = n.parent;
    return n.to;
  }

  run(tree: Tree): void {
    const module = this.scope('module', null);
    this.visitAll(kids(tree.topNode), module);
    this.resolve();
    this.report();
  }

  private visitAll(nodes: SyntaxNode[], scope: Scope): void {
    for (const node of nodes) this.visit(node, scope);
  }

  private visit(node: SyntaxNode, scope: Scope): void {
    switch (node.name) {
      case 'VariableName':
        return this.ref(scope, node);
      case 'PropertyName':
        return;
      case 'ImportStatement':
        return this.importStatement(node, scope);
      case 'DecoratedStatement':
        return this.decorated(node, scope);
      case 'FunctionDefinition':
        return this.functionDef(node, scope, []);
      case 'ClassDefinition':
        return this.classDef(node, scope, []);
      case 'LambdaExpression':
        return this.lambda(node, scope);
      case 'AssignStatement':
        return this.assign(node, scope);
      case 'UpdateStatement':
        return this.update(node, scope);
      case 'ForStatement':
        return this.forStatement(node, scope);
      case 'WhileStatement':
        return this.loop(node, () => this.visitAll(kids(node), scope));
      case 'TryStatement':
      case 'WithStatement':
        return this.asBindings(node, scope, node.name === 'TryStatement' ? 'except' : 'other');
      case 'ScopeStatement':
        return this.scopeStatement(node, scope);
      case 'NamedExpression':
        return this.named(node, scope);
      case 'ArgList':
        return this.argList(node, scope);
      case 'CapturePattern':
        return this.patternBind(node, scope);
      case 'AsPattern':
        return this.asBindings(node, scope, 'other');
      case 'KeywordPattern':
        return this.visitAll(kids(node).slice(1), scope);
      case 'BinaryExpression':
        this.comparison(node);
        return this.visitAll(kids(node), scope);
      default:
        if (COMPREHENSIONS.has(node.name)) return this.comprehension(node, scope);
        return this.visitAll(kids(node), scope);
    }
  }

  private loop(node: SyntaxNode, body: () => void): void {
    const outer = this.loops;
    this.loops = [...outer, [node.from, node.to]];
    body();
    this.loops = outer;
  }

  private importStatement(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    const isFrom = parts[0]?.name === 'from';
    const importAt = parts.findIndex((p) => p.name === 'import');
    const module = isFrom ? this.text.slice(parts[0].to, parts[importAt]?.from ?? node.to).trim() : '';
    const at = this.statementEnd(node);
    let group: SyntaxNode[] = [];
    const flush = () => {
      const names = group.filter((p) => p.name === 'VariableName');
      const hasAs = group.some((p) => p.name === 'as');
      if (group.some((p) => p.name === '*')) scope.star = true;
      if (names.length) {
        const target = hasAs || isFrom ? names[names.length - 1] : names[0];
        const kind: BindKind = module === '__future__' ? 'future' : 'import';
        const shown = this.text.slice(group[0].from, group[group.length - 1].to);
        this.bind(scope, target, kind, at, { shown });
      }
      group = [];
    };
    for (const part of parts.slice(importAt + 1)) {
      if (part.name === ',') flush();
      else if (part.name !== '(' && part.name !== ')') group.push(part);
    }
    flush();
  }

  private decorated(node: SyntaxNode, scope: Scope): void {
    const names: string[] = [];
    for (const child of kids(node)) {
      if (child.name === 'Decorator') {
        this.visitAll(kids(child), scope);
        names.push(this.slice(child).replace(/^@\s*/, '').replace(/\(.*$/s, '').trim());
      } else if (child.name === 'FunctionDefinition') this.functionDef(child, scope, names);
      else if (child.name === 'ClassDefinition') this.classDef(child, scope, names);
      else this.visit(child, scope);
    }
  }

  private params(list: SyntaxNode, outer: Scope, inner: Scope): void {
    for (const child of kids(list)) {
      if (child.name === 'VariableName') {
        if (child.prevSibling?.name === 'AssignOp') this.ref(outer, child);
        else this.bind(inner, child, 'param', -1);
      } else this.visit(child, outer);
    }
  }

  private functionDef(node: SyntaxNode, scope: Scope, decorators: string[]): void {
    const inner = this.scope('function', scope);
    for (const child of kids(node)) {
      if (child.name === 'VariableName') this.bind(scope, child, 'def', this.statementEnd(node), { decorators });
      else if (child.name === 'ParamList') this.params(child, scope, inner);
      else if (child.name === 'Body') this.visitAll(kids(child), inner);
      else this.visit(child, scope);
    }
  }

  private classDef(node: SyntaxNode, scope: Scope, decorators: string[]): void {
    const inner = this.scope('class', scope);
    for (const child of kids(node)) {
      if (child.name === 'VariableName') this.bind(scope, child, 'class', this.statementEnd(node), { decorators });
      else if (child.name === 'Body') this.visitAll(kids(child), inner);
      else this.visit(child, scope);
    }
  }

  private lambda(node: SyntaxNode, scope: Scope): void {
    const inner = this.scope('function', scope);
    for (const child of kids(node)) {
      if (child.name === 'ParamList') this.params(child, scope, inner);
      else this.visit(child, inner);
    }
  }

  /** Binds every name in an assignment target; attribute and item targets are reads of their object. */
  private target(node: SyntaxNode, scope: Scope, kind: BindKind, at: number, simple: boolean): void {
    switch (node.name) {
      case 'VariableName':
        return this.bind(scope, node, kind, at, { simple });
      case 'TupleExpression':
      case 'ArrayExpression':
      case 'ParenthesizedExpression':
        for (const child of kids(node)) this.target(child, scope, kind, at, false);
        return;
      case '(':
      case ')':
      case '[':
      case ']':
      case ',':
      case '*':
        return;
      default:
        return this.visit(node, scope);
    }
  }

  private assign(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    let last = -1;
    parts.forEach((p, i) => {
      if (p.name === 'AssignOp') last = i;
    });
    if (last < 0) {
      // An annotation alone, such as `x: int`.
      parts.forEach((p) =>
        p.name === 'TypeDef' ? this.visit(p, scope) : this.target(p, scope, 'assign', node.to, false),
      );
      return;
    }
    this.visitAll(parts.slice(last + 1), scope);
    const targets = parts.slice(0, last).filter((p) => p.name !== 'AssignOp' && p.name !== 'TypeDef');
    const simple = targets.length === 1 && targets[0].name === 'VariableName';
    for (const p of parts.slice(0, last)) {
      if (p.name === 'TypeDef') this.visit(p, scope);
      else if (p.name !== 'AssignOp') this.target(p, scope, 'assign', node.to, simple);
    }
    if (scope.kind === 'module' && simple && this.slice(targets[0]) === '__all__') {
      for (const m of this.slice(parts[last + 1] ?? node).matchAll(/['"]([A-Za-z_]\w*)['"]/g)) this.exported.add(m[1]);
    }
  }

  private update(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    this.visitAll(parts.slice(1), scope);
    if (parts[0]?.name === 'VariableName') {
      this.ref(scope, parts[0]);
      this.bind(scope, parts[0], 'other', node.to);
    } else if (parts[0]) this.visit(parts[0], scope);
  }

  private forStatement(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    const inAt = parts.findIndex((p) => p.name === 'in');
    if (inAt < 0) return this.visitAll(parts, scope);
    this.visitAll(parts.slice(inAt + 1, inAt + 2), scope);
    this.loop(node, () => {
      for (const p of parts.slice(1, inAt)) this.target(p, scope, 'loop', p.from, false);
      this.visitAll(parts.slice(inAt + 2), scope);
    });
  }

  private comprehension(node: SyntaxNode, scope: Scope): void {
    const inner = this.scope('comprehension', scope);
    let binding = false;
    for (const child of kids(node)) {
      if (child.name === 'for') binding = true;
      else if (child.name === 'in') binding = false;
      else if (binding) this.target(child, inner, 'loop', -1, false);
      else this.visit(child, inner);
    }
  }

  /** `except E as e`, `with x as y`, and `case p as q`: the name after `as` is bound. */
  private asBindings(node: SyntaxNode, scope: Scope, kind: BindKind): void {
    for (const child of kids(node)) {
      if (child.prevSibling?.name === 'as') {
        this.target(child, scope, kind, kind === 'except' ? child.from : this.statementEnd(node), kind === 'except');
      } else this.visit(child, scope);
    }
  }

  private patternBind(node: SyntaxNode, scope: Scope): void {
    const name = node.firstChild;
    if (name?.name === 'VariableName') this.bind(scope, name, 'other', this.statementEnd(node));
  }

  private scopeStatement(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    const set = parts[0]?.name === 'global' ? scope.globals : scope.nonlocals;
    for (const p of parts) if (p.name === 'VariableName') set.add(this.slice(p));
  }

  private named(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    this.visitAll(parts.slice(1), scope);
    if (parts[0]?.name === 'VariableName') this.bind(scope, parts[0], 'other', node.to);
  }

  private argList(node: SyntaxNode, scope: Scope): void {
    for (const child of kids(node)) {
      if (child.name === 'VariableName' && child.nextSibling?.name === 'AssignOp') continue;
      this.visit(child, scope);
    }
  }

  /** E711, E712, and F632, which read one comparison each. */
  private comparison(node: SyntaxNode): void {
    for (const op of kids(node)) {
      const word = this.slice(op);
      if (op.name === 'CompareOp' && (word === '==' || word === '!=')) {
        for (const side of [op.prevSibling, op.nextSibling]) {
          if (side?.name === 'None') this.add(side, 'warning', 'E711', 'noneComparison', { op: word });
          if (side?.name === 'Boolean')
            this.add(side, 'warning', 'E712', 'boolComparison', { op: word, value: this.slice(side) });
        }
      }
      if (op.name === 'is') {
        const right = op.nextSibling?.name === 'not' ? op.nextSibling.nextSibling : op.nextSibling;
        if ([op.prevSibling, right].some((side) => side && this.isLiteral(side))) {
          this.add(node, 'warning', 'F632', 'isLiteral', { op: op.nextSibling?.name === 'not' ? 'is not' : 'is' });
        }
      }
    }
  }

  private isLiteral(node: SyntaxNode): boolean {
    if (LITERALS.has(node.name)) return true;
    if (node.name === 'UnaryExpression') return node.lastChild?.name === 'Number';
    if (node.name === 'TupleExpression') return kids(node).every((c) => /^[(),]$/.test(c.name) || this.isLiteral(c));
    return false;
  }

  private add(
    node: { from: number; to: number },
    severity: Finding['severity'],
    code: string,
    message: Finding['message'],
    params?: Finding['params'],
  ): void {
    this.findings.push({ from: node.from, to: node.to, severity, code, message, params });
  }

  /** True when the reference runs later than the code of `target` around it: a function or lambda lies between. */
  private deferred(from: Scope, target: Scope): boolean {
    for (let s: Scope | null = from; s && s !== target; s = s.parent) {
      if (s.kind === 'function' || s.kind === 'comprehension') return true;
    }
    return false;
  }

  private pick(list: Binding[], ref: Ref, ordered: boolean): Binding | null {
    const before = list.filter((b) => b.at <= ref.from);
    if (before.length) return before[before.length - 1];
    if (!ordered) return list[list.length - 1];
    const inLoop = list.find((b) => ref.loops.some(([a, z]) => a <= b.from && b.from < z && a <= ref.from));
    return inLoop ?? null;
  }

  private lookup(ref: Ref): Binding | 'builtin' | 'star' | null {
    const start = ref.scope;
    let s: Scope | null = start;
    if (start.globals.has(ref.name)) s = this.scopes[0];
    let star = false;
    while (s) {
      star ||= s.star;
      const skipClass = s.kind === 'class' && s !== start;
      const list = skipClass ? undefined : s.bindings.get(ref.name);
      if (list?.length) {
        const ordered = (s.kind === 'module' || s.kind === 'class') && !this.deferred(start, s);
        const found = this.pick(list, ref, ordered);
        if (found) return found;
        if (s.kind === 'function') return list[0];
      }
      s = s.parent;
    }
    if (PYTHON_BUILTINS.has(ref.name) || (ref.name === '__class__' && start.kind === 'function')) return 'builtin';
    return star ? 'star' : null;
  }

  /** Marks a binding used, and with it the imports of the same name in other blocks (try and except variants). */
  private use(binding: Binding, from: Scope): void {
    binding.uses += 1;
    for (let s: Scope | null = from; s; s = s.parent) {
      const list = s.bindings.get(binding.name);
      if (!list?.includes(binding)) continue;
      for (const other of list)
        if (other !== binding && other.kind === 'import' && other.block !== binding.block) other.uses += 1;
      return;
    }
  }

  private resolve(): void {
    for (const ref of this.refs) {
      const found = this.lookup(ref);
      if (found === null) this.add(ref, 'error', 'F821', 'undefinedName', { name: ref.name });
      else if (typeof found === 'object') this.use(found, ref.scope);
    }
    for (const name of this.exported) {
      for (const b of this.scopes[0].bindings.get(name) ?? []) b.uses += 1;
    }
  }

  private report(): void {
    const starts = lineStarts(this.text);
    for (const scope of this.scopes) {
      for (const [name, list] of scope.bindings) {
        list.forEach((b, i) => {
          const prev = list[i - 1];
          if (
            prev &&
            (b.kind === 'def' || b.kind === 'class' || b.kind === 'import') &&
            (prev.kind === 'def' || prev.kind === 'class' || prev.kind === 'import') &&
            prev.uses === 0 &&
            prev.block === b.block &&
            !prev.decorators.some((d) => /(?:^|\.)overload$/.test(d))
          ) {
            this.add(b, 'warning', 'F811', 'redefined', { name, line: lineAt(starts, prev.from) });
            prev.uses = -1;
          }
        });
        for (const b of list)
          if (b.kind === 'import' && b.uses === 0) this.add(b, 'warning', 'F401', 'unusedImport', { name: b.shown });
        const used = list.some((b) => b.uses !== 0);
        const local = scope.kind === 'function' && !scope.callsLocals;
        const candidate = list.find((b) => b.simple && (b.kind === 'except' || (local && b.kind === 'assign')));
        if (!used && candidate && !DUMMY.test(name) && !scope.globals.has(name) && !scope.nonlocals.has(name)) {
          this.add(candidate, 'warning', 'F841', 'unusedLocal', { name });
        }
      }
    }
    this.indentation(starts);
    this.findings.sort((a, b) => a.from - b.from || a.code.localeCompare(b.code));
  }

  /** W191 and E101, read line by line as pycodestyle does, skipping lines inside multi-line strings. */
  private indentation(starts: readonly number[]): void {
    let indentChar = '';
    for (const start of starts) {
      const indent = /^[ \t]*/.exec(this.text.slice(start, start + 200))![0];
      const rest = this.text.charAt(start + indent.length);
      if (!indent || rest === '\n' || rest === '\r' || rest === '' || this.inString(start)) continue;
      indentChar ||= indent[0];
      const tab = indent.indexOf('\t');
      if (tab >= 0) this.add({ from: start, to: start + indent.length }, 'warning', 'W191', 'tabIndent');
      const mixed = [...indent].findIndex((c) => c !== indentChar);
      if (mixed >= 0) this.add({ from: start + mixed, to: start + indent.length }, 'warning', 'E101', 'mixedIndent');
    }
  }

  private stringRanges: [number, number][] | null = null;

  private inString(offset: number): boolean {
    return (this.stringRanges ?? []).some(([a, z]) => a < offset && offset < z);
  }

  collectStrings(tree: Tree): void {
    const ranges: [number, number][] = [];
    tree.iterate({
      enter: (n) => {
        if (n.name === 'String' || n.name === 'FormatString') {
          if (this.text.slice(n.from, n.to).includes('\n')) ranges.push([n.from, n.to]);
          return false;
        }
        return true;
      },
    });
    this.stringRanges = ranges;
  }
}

/** The Python checker's findings for a parsed file. */
export function checkPython(text: string, tree: Tree): Finding[] {
  const checker = new PythonChecker(text);
  checker.collectStrings(tree);
  checker.run(tree);
  return checker.findings;
}
