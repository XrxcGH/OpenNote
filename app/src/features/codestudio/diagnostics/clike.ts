// The C and C++ scope checker over the Lezer tree (layer L-b, DESIGN 6.1). It finds two things within one file:
// identifiers used as values that nothing in the file declares (clang's "use of undeclared identifier"), and local
// variables that are never used (clang's -Wunused-variable). Without the headers it cannot know every library name,
// so it stays quiet where a name could come from elsewhere: calls, qualified names, members inside classes and
// methods, files that include a project header, and `using namespace` other than std. Clang (layer L-e) covers those.

import type { SyntaxNode, Tree } from '@lezer/common';
import type { Finding } from './types';

interface Variable {
  name: string;
  from: number;
  to: number;
  local: boolean;
  /** Only plain values are reported unused: a class object may do its work in its constructor. */
  plain: boolean;
  uses: number;
}

interface Scope {
  parent: Scope | null;
  names: Map<string, Variable>;
}

/** Names the C and C++ standard headers define as values or macros, which a file may use without declaring. */
const C_NAMES = new Set(
  (
    'NULL EOF stdin stdout stderr errno true false nullptr RAND_MAX EXIT_SUCCESS EXIT_FAILURE INT_MAX INT_MIN ' +
    'UINT_MAX LONG_MAX LONG_MIN ULONG_MAX LLONG_MAX LLONG_MIN ULLONG_MAX CHAR_BIT CHAR_MAX CHAR_MIN SCHAR_MAX ' +
    'SCHAR_MIN UCHAR_MAX SHRT_MAX SHRT_MIN USHRT_MAX DBL_MAX DBL_MIN DBL_EPSILON FLT_MAX FLT_MIN FLT_EPSILON ' +
    'SIZE_MAX M_PI M_E HUGE_VAL INFINITY NAN BUFSIZ FILENAME_MAX SEEK_SET SEEK_CUR SEEK_END CLOCKS_PER_SEC ' +
    '__FILE__ __LINE__ __func__ __DATE__ __TIME__ __cplusplus this'
  ).split(' '),
);

/** Names `using namespace std;` brings in that people use as values. */
const STD_NAMES = new Set(
  (
    'cout cin cerr clog endl ends flush ws boolalpha noboolalpha fixed scientific hex dec oct left right internal ' +
    'showpoint noshowpoint npos'
  ).split(' '),
);

const PLAIN_TYPES = new Set(['PrimitiveType', 'SizedTypeSpecifier', 'auto']);
const DECLARATORS = new Set([
  'InitDeclarator',
  'PointerDeclarator',
  'ReferenceDeclarator',
  'ArrayDeclarator',
  'ParenthesizedDeclarator',
  'FunctionDeclarator',
]);

function kids(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

class CChecker {
  readonly findings: Finding[] = [];
  private readonly variables: Variable[] = [];
  private readonly refs: { name: string; from: number; to: number; scope: Scope; quiet: boolean }[] = [];
  private names = C_NAMES;
  private checkUndeclared = true;
  private member = 0;

  constructor(private readonly text: string) {}

  private slice(node: SyntaxNode): string {
    return this.text.slice(node.from, node.to);
  }

  run(tree: Tree): void {
    const usings = [...this.text.matchAll(/\busing\s+namespace\s+([\w:]+)/g)].map((m) => m[1]);
    if (usings.some((u) => u !== 'std') || /#\s*include\s*"/.test(this.text)) this.checkUndeclared = false;
    if (usings.includes('std')) this.names = new Set([...C_NAMES, ...STD_NAMES]);
    const file: Scope = { parent: null, names: new Map() };
    this.visitAll(kids(tree.topNode), file, false);
    for (const ref of this.refs) {
      let found: Variable | undefined;
      for (let s: Scope | null = ref.scope; s && !found; s = s.parent) found = s.names.get(ref.name);
      if (found) found.uses += 1;
      else if (!ref.quiet && this.checkUndeclared && !this.names.has(ref.name)) {
        this.findings.push({
          from: ref.from,
          to: ref.to,
          severity: 'error',
          code: 'undeclared-identifier',
          message: 'undeclared',
          params: { name: ref.name },
        });
      }
    }
    for (const v of this.variables) {
      if (v.local && v.plain && v.uses === 0) {
        this.findings.push({
          from: v.from,
          to: v.to,
          severity: 'warning',
          code: 'unused-variable',
          message: 'unusedVariable',
          params: { name: v.name },
        });
      }
    }
    this.findings.sort((a, b) => a.from - b.from);
  }

  private declare(scope: Scope, node: SyntaxNode, local: boolean, plain: boolean): void {
    const v: Variable = { name: this.slice(node), from: node.from, to: node.to, local, plain, uses: 0 };
    if (!scope.names.has(v.name)) scope.names.set(v.name, v);
    this.variables.push(v);
  }

  private visitAll(nodes: SyntaxNode[], scope: Scope, local: boolean): void {
    for (const node of nodes) this.visit(node, scope, local);
  }

  private visit(node: SyntaxNode, scope: Scope, local: boolean): void {
    switch (node.name) {
      case 'Identifier':
        this.refs.push({
          name: this.slice(node),
          from: node.from,
          to: node.to,
          scope,
          quiet: this.member > 0 || this.isCall(node),
        });
        return;
      case 'PreprocDirective':
        return this.preproc(node, scope);
      case 'ScopedIdentifier':
      case 'FieldIdentifier':
      case 'TypeIdentifier':
      case 'NamespaceIdentifier':
      case 'StatementIdentifier':
      case 'Attribute':
      case 'AttributeSpecifier':
      case 'UsingDeclaration':
      case 'NamespaceAliasDefinition':
      case 'FieldExpression':
        if (node.name === 'FieldExpression' && node.firstChild) this.visit(node.firstChild, scope, local);
        return;
      case 'Declaration':
      case 'FieldDeclaration':
      case 'TypeDefinition':
      case 'ParameterDeclaration':
        return this.declaration(node, scope, local);
      case 'Enumerator': {
        const id = node.getChild('Identifier');
        if (id) this.declare(scope, id, false, false);
        return this.visitAll(kids(node).slice(1), scope, local);
      }
      case 'FunctionDefinition':
        return this.functionDef(node, scope);
      case 'FieldDeclarationList':
        this.member += 1;
        this.visitAll(kids(node), { parent: scope, names: new Map() }, false);
        this.member -= 1;
        return;
      case 'CompoundStatement':
      case 'ForStatement':
      case 'ForRangeLoop':
      case 'LambdaExpression':
      case 'NamespaceDefinition':
        return this.visitAll(
          kids(node),
          { parent: scope, names: new Map() },
          local || node.name !== 'NamespaceDefinition',
        );
      default:
        return this.visitAll(kids(node), scope, local);
    }
  }

  private isCall(node: SyntaxNode): boolean {
    const parent = node.parent;
    return (
      (parent?.name === 'CallExpression' || parent?.name === 'TemplateFunction') &&
      parent.firstChild?.from === node.from
    );
  }

  private preproc(node: SyntaxNode, scope: Scope): void {
    const parts = kids(node);
    if (parts[0] && /^#\s*define$/.test(this.slice(parts[0]))) {
      const id = parts.find((p) => p.name === 'Identifier');
      if (id) this.declare(scope, id, false, false);
    }
  }

  /** Declares the name a declarator introduces; array sizes and initializers are reads. */
  private declarator(node: SyntaxNode, scope: Scope, local: boolean, plain: boolean): void {
    if (node.name === 'Identifier') return this.declare(scope, node, local, plain);
    if (node.name === 'FieldIdentifier' || node.name === 'TypeIdentifier') return;
    if (!DECLARATORS.has(node.name)) return this.visit(node, scope, local);
    const [first, ...rest] = kids(node);
    if (!first) return;
    const pointer = node.name === 'PointerDeclarator' || node.name === 'ArrayDeclarator';
    if (node.name === 'FunctionDeclarator') {
      if (first.name === 'Identifier') this.declare(scope, first, false, false);
      const prototype: Scope = { parent: scope, names: new Map() };
      for (const p of rest) this.visit(p, prototype, false);
      return;
    }
    const lead =
      DECLARATORS.has(first.name) || first.name === 'Identifier'
        ? first
        : rest.find((r) => DECLARATORS.has(r.name) || r.name === 'Identifier');
    if (lead) this.declarator(lead, scope, local, plain || pointer);
    for (const r of [first, ...rest]) if (r !== lead) this.visit(r, scope, local);
  }

  private declaration(node: SyntaxNode, scope: Scope, local: boolean): void {
    const parts = kids(node);
    const attributed = /maybe_unused|__attribute__\s*\(\s*\(\s*unused/.test(this.slice(node));
    const plain = !attributed && parts.some((p) => PLAIN_TYPES.has(p.name)) && node.name === 'Declaration';
    const isLocal =
      local && node.name === 'Declaration' && !parts.some((p) => /^(?:static|extern)$/.test(this.slice(p)));
    for (const p of parts) {
      if (p.name === 'Identifier' || DECLARATORS.has(p.name)) this.declarator(p, scope, isLocal, plain);
      else if (p.name !== 'FieldIdentifier') this.visit(p, scope, local);
    }
  }

  private functionDef(node: SyntaxNode, scope: Scope): void {
    const inner: Scope = { parent: scope, names: new Map() };
    const declarator = node.getChild('FunctionDeclarator');
    const name = declarator?.firstChild;
    const method = this.member > 0 || (name !== null && name !== undefined && name.name !== 'Identifier');
    if (name?.name === 'Identifier') this.declare(scope, name, false, false);
    if (method) this.member += 1;
    for (const child of kids(node)) {
      if (child === declarator || child.from === declarator?.from) {
        for (const p of kids(child).slice(1)) this.visit(p, inner, false);
      } else if (child.name === 'CompoundStatement') this.visitAll(kids(child), inner, true);
      else this.visit(child, scope, false);
    }
    if (method) this.member -= 1;
  }
}

/** The C or C++ checker's findings for a parsed file. */
export function checkCLike(text: string, tree: Tree): Finding[] {
  const checker = new CChecker(text);
  checker.run(tree);
  return checker.findings;
}
