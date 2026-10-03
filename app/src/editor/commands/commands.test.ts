// The editor commands on their own. Marks toggle over mixed selections, and Turn into keeps text between every
// kind. List shortcuts toggle, links normalize their address and refuse scripts, and checked tasks cycle.
import { describe, expect, it } from 'vitest';
import { cycleTodo, insertDivider, toggleCheck } from './blocks';
import { normalizeHref, removeLink, setLink } from './links';
import { clearFormatting, setHighlight, stepTextSize, toggleMark } from './marks';
import { TextSelection } from '@tiptap/pm/state';
import { EditorState } from '@tiptap/pm/state';
import type { Command } from './command';
import { applyTo, marked, markdownOf } from './testing';
import { blockKindAt, caretInLink, inTaskItem, isMarkActive, linkApplies } from './state';
import { toggleKind, turnInto } from './turnInto';

/** Runs a command with all the document's text selected. */
function applyToAll(source: string, command: Command): string | null {
  const { doc } = marked(source).state;
  const state = EditorState.create({
    doc,
    selection: TextSelection.between(doc.resolve(1), doc.resolve(doc.content.size - 1)),
  });
  let after: EditorState | null = null;
  const ran = command(state, (tr) => (after = state.apply(tr)));
  return ran && after ? markdownOf(after) : null;
}

describe('marks', () => {
  it('turn on over a partly marked selection, and off when all of it has the mark', () => {
    expect(applyTo('[a **b**] c', toggleMark('bold'))).toBe('**a b** c');
    expect(applyTo('**[ab]** c', toggleMark('bold'))).toBe('ab c');
  });

  it('step text size through small, normal, large, and extra large, and stop at the ends', () => {
    expect(applyTo('[a]', stepTextSize(1))).toBe('<span data-size="large">a</span>');
    expect(applyTo('<span data-size="xlarge">[a]</span>', stepTextSize(1))).toBeNull();
    expect(applyTo('<span data-size="small">[a]</span>', stepTextSize(1))).toBe('a');
  });

  it('highlight in a color and take it off', () => {
    expect(applyTo('[a]', setHighlight('mint'))).toBe('<mark data-color="mint">a</mark>');
    expect(applyTo('==[a]==', setHighlight('none'))).toBe('a');
  });

  it('clear every format but links', () => {
    expect(applyToAll('**a** [b](https://x.org)', clearFormatting())).toBe('a [b](https://x.org)');
  });

  it('never apply inside code blocks', () => {
    expect(applyTo('```\n[code]\n```', toggleMark('bold'))).toBeNull();
  });
});

describe('Turn into', () => {
  const kinds = [
    ['paragraph', 'Words'],
    ['heading2', '## Words'],
    ['bulletList', '- Words'],
    ['orderedList', '1. Words'],
    ['checklist', '- [ ] Words'],
    ['quote', '> Words'],
    ['codeBlock', '```\nWords\n```'],
  ] as const;

  it('converts between every kind and keeps the text', () => {
    for (const [, from] of kinds) {
      for (const [kind, to] of kinds) {
        if (from === to) continue;
        const source = from.includes('```') ? '```\n[Words]\n```' : from.replace('Words', '[Words]');
        expect(applyTo(source, turnInto(kind)), `${from} → ${kind}`).toBe(to);
      }
    }
  });

  it('drops marks going into code and keeps plain text coming out', () => {
    expect(applyTo('**[bold]** text', turnInto('codeBlock'))).toBe('```\nbold text\n```');
  });

  it('wraps in a callout with an empty title, and unwraps', () => {
    expect(applyTo('[Words]', turnInto('callout'))).toBe('> [!note]\n>\n> Words');
    expect(applyTo('> [!note]\n>\n> [Words]', toggleKind('callout'))).toBe('Words');
  });

  it('toggles a list kind the selection already is back to text', () => {
    expect(applyTo('- [one]', toggleKind('bulletList'))).toBe('one');
    expect(applyTo('- [one]', toggleKind('orderedList'))).toBe('1. one');
    expect(applyTo('## [Title]', toggleKind('heading2'))).toBe('Title');
  });
});

describe('tasks and dividers', () => {
  it('check several tasks, then uncheck them all', () => {
    expect(applyToAll('- [ ] one\n- [x] two', toggleCheck())).toBe('- [x] one\n- [x] two');
    expect(applyToAll('- [x] one\n- [x] two', toggleCheck())).toBe('- [ ] one\n- [ ] two');
    expect(applyTo('[plain]', toggleCheck())).toBeNull();
  });

  it('cycle To Do: open, checked, then no box', () => {
    expect(applyTo('[one]', cycleTodo())).toBe('- [ ] one');
    expect(applyTo('- [ ] [one]', cycleTodo())).toBe('- [x] one');
    expect(applyTo('- [x] [one]', cycleTodo())).toBe('- one');
  });

  it('insert a divider after the block, or in place of an empty paragraph', () => {
    expect(applyTo('one[]', insertDivider())).toBe('one\n\n---');
  });
});

describe('links', () => {
  it('normalize addresses as people type them', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com');
    expect(normalizeHref('ada@example.com')).toBe('mailto:ada@example.com');
    expect(normalizeHref('opennote:page/abc')).toBe('opennote:page/abc');
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('')).toBeNull();
  });

  it('link the selection, insert the address at a caret, and remove a link', () => {
    expect(applyTo('a [b] c', setLink('example.com'))).toBe('a [b](https://example.com) c');
    expect(applyTo('see []', setLink('example.com'))).toBe('see [https://example.com](https://example.com)');
    expect(applyToAll('[b](https://x.org)', removeLink())).toBe('b');
  });
});

describe('selection state', () => {
  it('reads marks, kinds, tasks, and links at the selection', () => {
    expect(isMarkActive(marked('**[a]**').state, 'bold')).toBe(true);
    expect(blockKindAt(marked('1. [a]').state)).toBe('orderedList');
    expect(blockKindAt(marked('- [ ] [a]').state)).toBe('checklist');
    expect(blockKindAt(marked('#### [a]').state)).toBe('heading4');
    expect(inTaskItem(marked('- [ ] [a]').state)).toBe(true);
    expect(linkApplies(marked('a []b').state)).toBe(false);
    expect(caretInLink(marked('[[a]](https://x.org)').state)).toBe(true);
  });
});
