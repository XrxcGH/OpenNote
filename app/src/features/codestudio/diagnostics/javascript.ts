// OpenNote's JavaScript and TypeScript name checker over the Lezer tree (layer L-b, DESIGN 6.1). It uses ESLint's
// rule names and default options as ESLint documents them:
// - no-undef, where `typeof` is allowed;
// - no-unused-vars with vars "all", args "after-used", and caughtErrors "all". A write is not a use, and neither is a
//   read that only feeds the variable's own update. A function that only calls itself is unused;
// - no-const-assign.
// `/*global a, b*/` comments declare names, as in ESLint. The shape rules live in jsFlow.ts.

import type { SyntaxNode, Tree } from '@lezer/common';
import { checkFlow } from './jsFlow';
import { JS_GLOBALS } from './jsGlobals';
import type { Finding } from './types';

type Kind = 'var' | 'let' | 'const' | 'function' | 'class' | 'param' | 'catch' | 'import' | 'global' | 'quiet';

interface Binding {
  name: string;
  from: number;
  to: number;
  kind: Kind;
  /** Set when the declaration gives a value, for "assigned" in the message. */
  init: boolean;
  /** References inside this range are the binding's own (a function calling itself). */
  self: [number, number] | null;
  reads: number;
  writes: { from: number; to: number }[];
  exported: boolean;
}

interface Scope {
  parent: Scope | null;
  /** Function scopes hold `var` and function names; block scopes hold `let`, `const`, and classes. */
  fn: boolean;
  names: Map<string, Binding>;
}

interface Ref {
  name: string;
  from: number;
  to: number;
  scope: Scope;
  read: boolean;
  write: boolean;
  /** `x = x + 1` or `x++` as a statement: the read only feeds the variable's own update. */
  selfOnly: boolean;
  typeOf: boolean;
  type: boolean;
}

interface Params {
  list: Binding[];
}

const FUNCTION_VALUES = /^(?:FunctionExpression|ArrowFunction|ClassExpression)$/;

function kids(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

class JsChecker {
  readonly findings: Finding[] = [];
  private readonly refs: Ref[] = [];
  private readonly bindings: Binding[] = [];
  private readonly params: Params[] = [];
  private readonly top: Scope = { parent: null, fn: true, names: new Map() };
  private selfTarget: string | null = null;

  constructor(private readonly text: string) {}

  private slice(node: { from: number; to: number }): string {
    return this.text.slice(node.from, node.to);
  }

  private fnScope(scope: Scope): Scope {
    let s = scope;
    while (!s.fn && s.parent) s = s.parent;
    return s;
  }

  private declare(
    scope: Scope,
    node: { from: number; to: number },
    kind: Kind,
    init: boolean,
    self: [number, number] | null = null,
  ): Binding {
    const name = this.slice(node);
    const target = kind === 'var' || kind === 'function' ? (kind === 'var' ? this.fnScope(scope) : scope) : scope;
    const existing = target.names.get(name);
    if (existing) return existing;
    const binding: Binding = {
      name,
      from: node.from,
      to: node.to,
      kind,
      init,
      self,
      reads: 0,
      writes: [],
      exported: false,
    };
    target.names.set(name, binding);
    this.bindings.push(binding);
    return binding;
  }

  private ref(scope: Scope, node: SyntaxNode, extra: Partial<Ref> = {}): void {
    const name = this.slice(node);
    this.refs.push({
      name,
      from: node.from,
      to: node.to,
      scope,
      read: true,
      write: false,
      selfOnly: this.selfTarget === name,
      typeOf: false,
      type: false,
      ...extra,
    });
  }

  run(tree: Tree): void {
    this.globalComments(tree);
    this.visitAll(kids(tree.topNode), this.top);
    this.resolve();
    this.report();
  }

  private globalComments(tree: Tree): void {
    for (const comment of tree.topNode.getChildren('BlockComment')) {
      const match = /^\/\*\s*(globals?|exported)\s+([\s\S]*?)\*\/$/.exec(this.slice(comment));
      if (!match) continue;
      for (const entry of match[2].split(',')) {
        const name = entry.split(':')[0].trim();
        if (!/^[\w$]+$/.test(name)) continue;
        if (match[1] === 'exported') {
          const b = this.top.names.get(name);
          if (b) b.exported = true;
          continue;
        }
        const at = comment.from + this.slice(comment).indexOf(name);
        this.declare(this.top, { from: at, to: at + name.length }, 'global', false);
      }
    }
  }

  private visitAll(nodes: SyntaxNode[], scope: Scope): void {
    for (const node of nodes) this.visit(node, scope);
  }

  private visit(node: SyntaxNode, scope: Scope): void {
    switch (node.name) {
      case 'VariableName':
        return this.ref(scope, node);
      case 'TypeName':
        return this.ref(scope, node, { type: true });
      case 'TypeDefinition':
        this.declare(scope, node, 'quiet', true);
        return;
      case 'VariableDeclaration':
        return this.declaration(node, scope);
      case 'ForOfSpec':
      case 'ForInSpec':
        return this.declaration(node, scope);
      case 'ForStatement': {
        const inner: Scope = { parent: scope, fn: false, names: new Map() };
        return this.visitAll(kids(node), inner);
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunction':
      case 'MethodDeclaration':
        return this.functionNode(node, scope);
      case 'ClassDeclaration':
      case 'ClassExpression':
        return this.classNode(node, scope);
      case 'Block':
        return this.visitAll(kids(node), { parent: scope, fn: false, names: new Map() });
      case 'CatchClause':
        return this.catchClause(node, scope);
      case 'ImportDeclaration':
        return this.importNode(node, scope);
      case 'ExportDeclaration':
        return this.exportNode(node, scope);
      case 'AssignmentExpression':
        return this.assignment(node, scope);
      case 'PostfixExpression':
      case 'UnaryExpression':
        return this.unary(node, scope);
      case 'Property':
        return this.property(node, scope);
      case 'NamespaceDeclaration':
      case 'EnumDeclaration':
      case 'AmbientDeclaration':
        return this.quiet(node, scope);
      case 'PropertyName':
      case 'PropertyDefinition':
      case 'PrivatePropertyDefinition':
      case 'Label':
        return;
      default:
        return this.visitAll(kids(node), scope);
    }
  }

  /** Declarations people do not expect a warning for: namespaces, enums, and `declare`. */
  private quiet(node: SyntaxNode, scope: Scope): void {
    for (const child of kids(node)) {
      if (child.name === 'VariableDefinition' || child.name === 'TypeDefinition')
        this.declare(scope, child, 'quiet', true);
      else if (child.name === 'VariableDeclaration') {
        for (const d of child.getChildren('VariableDefinition')) this.declare(scope, d, 'quiet', true);
      } else this.visit(child, scope);
    }
  }

  /** Binds every name in a pattern; defaults and computed keys are reads. */
  private pattern(node: SyntaxNode, scope: Scope, kind: Kind, init: boolean, out: Binding[]): void {
    switch (node.name) {
      case 'VariableDefinition':
        out.push(this.declare(scope, node, kind, init));
        return;
      case 'ArrayPattern':
      case 'ObjectPattern':
      case 'PatternProperty':
        for (const child of kids(node)) {
          if (child.prevSibling?.name === 'Equals' || child.name === 'TypeAnnotation') this.visit(child, scope);
          else if (child.name !== 'PropertyName') this.pattern(child, scope, kind, init, out);
        }
        return;
      default:
        if (/^[[\](){}:,=.]|^Spread$|^Equals$/.test(node.name)) return;
        this.visit(node, scope);
    }
  }

  private declaration(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node).filter((p) => p.name !== '(' && p.name !== ')');
    const keyword = parts[0]?.name;
    const kind: Kind = keyword === 'const' ? 'const' : keyword === 'let' ? 'let' : 'var';
    const loop = node.name !== 'VariableDeclaration';
    if (loop && keyword !== 'var' && keyword !== 'let' && keyword !== 'const') {
      // `for (x of list)`: the loop writes an existing name.
      if (parts[0]) this.writeTarget(parts[0], scope, false);
      return this.visitAll(parts.slice(1), scope);
    }
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part.name === 'VariableDefinition' || part.name === 'ArrayPattern' || part.name === 'ObjectPattern') {
        let j = i + 1;
        while (parts[j]?.name === 'TypeAnnotation' || parts[j]?.name === 'Optional') this.visit(parts[j++], scope);
        const value = parts[j]?.name === 'Equals' ? parts[j + 1] : undefined;
        const self: [number, number] | null = value && FUNCTION_VALUES.test(value.name) ? [value.from, value.to] : null;
        const made: Binding[] = [];
        this.pattern(part, scope, kind, !!value || loop, made);
        if (self) made.forEach((b) => (b.self = self));
      } else if (part.name !== 'TypeAnnotation' && part.name !== 'Optional') this.visit(part, scope);
    }
  }

  private paramList(list: SyntaxNode, inner: Scope): void {
    const record: Params = { list: [] };
    this.params.push(record);
    for (const child of kids(list)) {
      if (child.name === 'VariableDefinition') {
        const b = this.declare(inner, child, 'param', true);
        if (child.prevSibling?.name === 'Privacy' || child.prevSibling?.name === 'readonly') b.exported = true;
        record.list.push(b);
      } else if (child.name === 'ArrayPattern' || child.name === 'ObjectPattern') {
        const made: Binding[] = [];
        this.pattern(child, inner, 'let', true, made);
      } else if (
        child.prevSibling?.name === 'Equals' ||
        child.name === 'TypeAnnotation' ||
        child.name === 'Decorator'
      ) {
        this.visit(child, inner);
      }
    }
  }

  private functionNode(node: SyntaxNode, scope: Scope): void {
    const inner: Scope = { parent: scope, fn: true, names: new Map() };
    for (const child of kids(node)) {
      if (child.name === 'VariableDefinition' && child.nextSibling?.name !== 'Arrow') {
        if (node.name === 'FunctionDeclaration') this.declare(scope, child, 'function', true, [node.from, node.to]);
        else this.declare(inner, child, 'quiet', true);
      } else if (child.name === 'VariableDefinition') {
        this.params.push({ list: [this.declare(inner, child, 'param', true)] });
      } else if (child.name === 'ParamList') this.paramList(child, inner);
      else if (child.name === 'Block') this.visitAll(kids(child), inner);
      else this.visit(child, inner);
    }
  }

  private classNode(node: SyntaxNode, scope: Scope): void {
    const inner: Scope = { parent: scope, fn: false, names: new Map() };
    for (const child of kids(node)) {
      if (child.name === 'VariableDefinition') {
        if (node.name === 'ClassDeclaration') this.declare(scope, child, 'class', true, [node.from, node.to]);
        else this.declare(inner, child, 'quiet', true);
      } else this.visit(child, inner);
    }
  }

  private catchClause(node: SyntaxNode, scope: Scope): void {
    const inner: Scope = { parent: scope, fn: false, names: new Map() };
    for (const child of kids(node)) {
      if (child.name === 'VariableDefinition' || child.name === 'ArrayPattern' || child.name === 'ObjectPattern') {
        this.pattern(child, inner, 'catch', true, []);
      } else if (child.name === 'Block') this.visitAll(kids(child), inner);
      else this.visit(child, inner);
    }
  }

  private importNode(node: SyntaxNode, scope: Scope): void {
    const typeOnly = node.getChild('type') !== null;
    const walk = (n: SyntaxNode) => {
      for (const child of kids(n)) {
        if (child.name === 'VariableDefinition') this.declare(scope, child, typeOnly ? 'quiet' : 'import', true);
        else if (child.name === 'ImportGroup') walk(child);
      }
    };
    walk(node);
  }

  private exportNode(node: SyntaxNode, scope: Scope): void {
    const group = node.getChild('ExportGroup');
    if (group) {
      if (node.getChild('from')) return;
      for (const child of kids(group)) {
        if (child.name === 'VariableName' && child.prevSibling?.name !== 'as') this.ref(scope, child);
      }
      return;
    }
    const before = this.bindings.length;
    this.visitAll(kids(node), scope);
    const own = new Set(scope.names.values());
    for (const b of this.bindings.slice(before)) if (own.has(b)) b.exported = true;
  }

  private statementLevel(node: SyntaxNode): boolean {
    let parent = node.parent;
    while (parent?.name === 'ParenthesizedExpression') parent = parent.parent;
    return parent?.name === 'ExpressionStatement';
  }

  private writeTarget(node: SyntaxNode, scope: Scope, read: boolean): void {
    if (node.name === 'VariableName') return this.ref(scope, node, { write: true, read, selfOnly: read });
    if (node.name === 'ArrayPattern' || node.name === 'ObjectPattern' || node.name === 'PatternProperty') {
      for (const child of kids(node)) {
        if (child.prevSibling?.name === 'Equals') this.visit(child, scope);
        else if (child.name !== 'PropertyName') this.writeTarget(child, scope, false);
      }
      return;
    }
    if (node.name === 'ParenthesizedExpression') return kids(node).forEach((c) => this.writeTarget(c, scope, read));
    this.visit(node, scope);
  }

  private assignment(node: SyntaxNode, scope: Scope): void {
    const [target, op, ...rest] = kids(node);
    if (!target) return;
    const compound = op?.name === 'UpdateOp';
    const own = this.statementLevel(node) && target.name === 'VariableName';
    this.writeTarget(target, scope, compound);
    if (compound && !own) this.refs[this.refs.length - 1].selfOnly = false;
    const outer = this.selfTarget;
    this.selfTarget = own ? this.slice(target) : null;
    this.visitAll(rest, scope);
    this.selfTarget = outer;
  }

  private unary(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    const update = parts.find((p) => p.name === 'ArithOp' && /^(?:\+\+|--)$/.test(this.slice(p)));
    const operand = parts.find((p) => p.name === 'VariableName');
    if (update && operand) {
      this.ref(scope, operand, { write: true, selfOnly: this.statementLevel(node) });
      return;
    }
    if (parts[0]?.name === 'typeof' && operand && parts.length === 2) {
      this.ref(scope, operand, { typeOf: true });
      return;
    }
    this.visitAll(parts, scope);
  }

  private property(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    if (parts.length === 1 && parts[0].name === 'PropertyDefinition') return this.ref(scope, parts[0]);
    if (node.getChild('ParamList')) return this.functionNode(node, scope);
    this.visitAll(parts, scope);
  }

  private lookup(ref: Ref): Binding | null {
    for (let s: Scope | null = ref.scope; s; s = s.parent) {
      const b = s.names.get(ref.name);
      if (b) return b;
    }
    return null;
  }

  private resolve(): void {
    for (const ref of this.refs) {
      const b = this.lookup(ref);
      if (!b) {
        if (!ref.type && !ref.typeOf && !JS_GLOBALS.has(ref.name) && ref.name !== 'arguments') {
          this.findings.push({
            from: ref.from,
            to: ref.to,
            severity: 'error',
            code: 'no-undef',
            message: 'undefinedVar',
            params: { name: ref.name },
          });
        }
        continue;
      }
      if (ref.write) {
        b.writes.push({ from: ref.from, to: ref.to });
        if (b.kind === 'const') {
          this.findings.push({
            from: ref.from,
            to: ref.to,
            severity: 'error',
            code: 'no-const-assign',
            message: 'constAssign',
            params: { name: ref.name },
          });
        }
      }
      const inSelf = b.self !== null && b.self[0] <= ref.from && ref.to <= b.self[1];
      if ((ref.read && !ref.selfOnly && !inSelf) || ref.type) b.reads += 1;
    }
  }

  private report(): void {
    const afterUsed = new Set<Binding>();
    for (const { list } of this.params) {
      const last = list.map((b) => b.reads > 0).lastIndexOf(true);
      list.slice(0, last + 1).forEach((b) => afterUsed.add(b));
    }
    for (const b of this.bindings) {
      if (b.reads > 0 || b.exported || b.kind === 'quiet' || afterUsed.has(b) || b.name.length === 0) continue;
      const at = b.writes[b.writes.length - 1] ?? b;
      const assigned = b.init || b.writes.length > 0;
      this.findings.push({
        from: at.from,
        to: at.to,
        severity: 'warning',
        code: 'no-unused-vars',
        message: 'unusedVar',
        params: {
          name: b.name,
          kind:
            assigned && b.kind !== 'function' && b.kind !== 'class' && b.kind !== 'param' && b.kind !== 'import'
              ? 'assigned'
              : 'defined',
        },
      });
    }
  }
}

/** The JavaScript or TypeScript checker's findings for a parsed file. */
export function checkJavaScript(text: string, tree: Tree): Finding[] {
  const checker = new JsChecker(text);
  checker.run(tree);
  return [...checker.findings, ...checkFlow(text, tree)].sort(
    (a, b) => a.from - b.from || a.code.localeCompare(b.code),
  );
}
