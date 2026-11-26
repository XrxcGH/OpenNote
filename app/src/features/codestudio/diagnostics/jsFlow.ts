// The JavaScript and TypeScript rules that read the shape of the code rather than its names, with ESLint's rule
// names and default options as ESLint documents them: no-unreachable, eqeqeq ("always"), no-cond-assign
// ("except-parens"), and no-fallthrough (a comment matching /falls?\s?through/i allows it).

import type { SyntaxNode, Tree } from '@lezer/common';
import type { Finding } from './types';

const SKIP = new Set([';', '{', '}', ':', 'LineComment', 'BlockComment', '⚠']);
const FALLS_THROUGH = /falls?\s?through/i;

function kids(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function statements(node: SyntaxNode): SyntaxNode[] {
  return kids(node).filter((c) => !SKIP.has(c.name) && !c.type.isError);
}

export class FlowRules {
  readonly findings: Finding[] = [];

  constructor(private readonly text: string) {}

  run(tree: Tree): void {
    const cursor = tree.cursor();
    do {
      const node = cursor.node;
      switch (node.name) {
        case 'Script':
        case 'Block':
          this.unreachable(statements(node));
          break;
        case 'SwitchBody':
          this.switchBody(node);
          break;
        case 'BinaryExpression':
          this.eqeqeq(node);
          break;
        case 'IfStatement':
        case 'WhileStatement':
        case 'DoStatement':
          this.condition(node.getChild('ParenthesizedExpression'), 2);
          break;
        case 'ForSpec':
          this.condition(this.forTest(node), 1);
          break;
        case 'ConditionalExpression':
          this.condition(node.firstChild, 1);
          break;
      }
    } while (cursor.next());
  }

  private add(
    from: number,
    to: number,
    severity: Finding['severity'],
    code: string,
    message: Finding['message'],
    params?: Finding['params'],
  ): void {
    this.findings.push({ from, to, severity, code, message, params });
  }

  /** True when control never reaches the statement after `node`. */
  terminates(node: SyntaxNode): boolean {
    switch (node.name) {
      case 'ReturnStatement':
      case 'ThrowStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
        return true;
      case 'Block':
        return statements(node).some((s) => this.terminates(s));
      case 'IfStatement': {
        const branches = statements(node).filter((c) => !['if', 'else', 'ParenthesizedExpression'].includes(c.name));
        return node.getChild('else') !== null && branches.length === 2 && branches.every((b) => this.terminates(b));
      }
      case 'TryStatement': {
        const block = node.getChild('Block');
        const handler = node.getChild('CatchClause')?.getChild('Block');
        const final = node.getChild('FinallyClause')?.getChild('Block');
        if (final && this.terminates(final)) return true;
        return !!block && this.terminates(block) && (!handler || this.terminates(handler));
      }
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoStatement':
        return this.infinite(node) && !this.breaksOut(node, null);
      case 'LabeledStatement': {
        const inner = node.lastChild;
        const label = node.getChild('Label');
        return !!inner && this.infinite(inner) && !this.breaksOut(inner, label ? this.slice(label) : null);
      }
      default:
        return false;
    }
  }

  private slice(node: SyntaxNode): string {
    return this.text.slice(node.from, node.to);
  }

  private forTest(spec: SyntaxNode): SyntaxNode | null {
    // ForSpec reads: init ";" test ";" update. The test is what sits between the first and second semicolon.
    const parts = kids(spec);
    const semis = parts.flatMap((p, i) =>
      p.name === ';' || (p.name === 'VariableDeclaration' && this.slice(p).endsWith(';')) ? [i] : [],
    );
    if (semis.length < 2) return null;
    const between = parts.slice(semis[0] + 1, semis[1]).filter((p) => p.name !== ';');
    return between[0] ?? null;
  }

  private infinite(loop: SyntaxNode): boolean {
    if (loop.name === 'ForStatement') {
      const spec = loop.getChild('ForSpec');
      return !!spec && this.forTest(spec) === null;
    }
    if (loop.name === 'WhileStatement' || loop.name === 'DoStatement') {
      const test = loop.getChild('ParenthesizedExpression');
      return !!test && /^\(\s*true\s*\)$/.test(this.slice(test));
    }
    return false;
  }

  /** True when a `break` inside `loop` leaves it: an unlabeled one outside inner loops and switches, or `break label`. */
  private breaksOut(loop: SyntaxNode, label: string | null): boolean {
    const walk = (node: SyntaxNode, nested: boolean): boolean => {
      for (const child of kids(node)) {
        if (child.name === 'BreakStatement') {
          const target = child.getChild('Label');
          if (target ? this.slice(target) === label : !nested) return true;
        }
        if (/^(?:Function|Arrow|Class|Method)/.test(child.name)) continue;
        const inner = nested || /^(?:For|While|Do|Switch)Statement$/.test(child.name);
        if (walk(child, inner)) return true;
      }
      return false;
    };
    return walk(loop, false);
  }

  private isUnreachableKind(node: SyntaxNode): boolean {
    if (node.name === 'FunctionDeclaration' || node.name === 'EmptyStatement') return false;
    if (node.name === 'VariableDeclaration' && node.firstChild?.name === 'var') return node.getChild('Equals') !== null;
    return !/Declaration$/.test(node.name) || node.name === 'VariableDeclaration' || node.name === 'ClassDeclaration';
  }

  /** no-unreachable: one mark over each run of statements after one that never completes. */
  private unreachable(list: SyntaxNode[]): void {
    let dead = false;
    const run = { from: -1, to: -1 };
    const flush = () => {
      if (run.from >= 0) this.add(run.from, run.to, 'warning', 'no-unreachable', 'unreachable');
      run.from = -1;
    };
    for (const node of list) {
      if (node.name === 'CaseLabel' || node.name === 'DefaultLabel') {
        flush();
        dead = false;
        continue;
      }
      if (dead && this.isUnreachableKind(node)) {
        if (run.from < 0) run.from = node.from;
        run.to = node.to;
      } else if (dead) flush();
      if (!dead && this.terminates(node)) dead = true;
    }
    flush();
  }

  private switchBody(body: SyntaxNode): void {
    const items = kids(body).filter((c) => !['{', '}', '⚠'].includes(c.name));
    this.unreachable(items.filter((c) => c.name !== 'LineComment' && c.name !== 'BlockComment'));
    let group: SyntaxNode[] = [];
    let seenLabel = false;
    for (const item of items) {
      if (item.name === 'CaseLabel' || item.name === 'DefaultLabel') {
        const code = group.filter((g) => g.name !== 'LineComment' && g.name !== 'BlockComment');
        const last = code[code.length - 1];
        const comment = group[group.length - 1];
        const allowed =
          comment && comment !== last && /Comment$/.test(comment.name) && FALLS_THROUGH.test(this.slice(comment));
        if (seenLabel && last && !this.terminates(last) && !allowed) {
          this.add(item.from, item.to, 'hint', 'no-fallthrough', 'fallthrough');
        }
        seenLabel = true;
        group = [];
      } else group.push(item);
    }
  }

  private eqeqeq(node: SyntaxNode): void {
    for (const op of kids(node)) {
      const word = this.slice(op);
      if (op.name === 'CompareOp' && (word === '==' || word === '!=')) {
        this.add(op.from, op.to, 'hint', 'eqeqeq', 'eqeqeq', { op: word, better: `${word}=` });
      }
    }
  }

  /**
   * no-cond-assign with "except-parens": an assignment in a test is reported unless it has parentheses of its own.
   * `if`, `while`, and `do` tests already sit in parentheses, so they need a second pair; `for` and `?:` need one.
   */
  private condition(test: SyntaxNode | null, depth: number): void {
    let node = test;
    let parens = 0;
    while (node?.name === 'ParenthesizedExpression') {
      parens += 1;
      node = statements(node).find((c) => c.name !== '(' && c.name !== ')') ?? null;
    }
    if (node?.name === 'AssignmentExpression' && parens < depth)
      this.add(node.from, node.to, 'warning', 'no-cond-assign', 'condAssign');
  }
}

export function checkFlow(text: string, tree: Tree): Finding[] {
  const rules = new FlowRules(text);
  rules.run(tree);
  return rules.findings;
}
