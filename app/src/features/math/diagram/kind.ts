// Diagrams from text (Further features, Phase 7): the starting texts, and which kind of diagram a text is, from its
// first word. Drawing itself is in render.ts, which loads Mermaid only when a diagram is shown.

export type DiagramKind = 'flowchart' | 'sequence' | 'timeline' | 'class' | 'other';
export const STARTERS: readonly Exclude<DiagramKind, 'other'>[] = ['flowchart', 'sequence', 'timeline', 'class'];

export const STARTER_TEXT: Readonly<Record<Exclude<DiagramKind, 'other'>, string>> = {
  flowchart:
    'flowchart TD\n  A[Start] --> B{Is it ready?}\n  B -->|Yes| C[Share it]\n  B -->|No| D[Keep working]\n  D --> B',
  sequence:
    'sequenceDiagram\n  participant S as Student\n  participant T as Teacher\n  S->>T: Question\n  T-->>S: Answer',
  timeline: 'timeline\n  title The project\n  2024 : Idea\n  2025 : First draft\n  2026 : Finished',
  class: 'classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  class Dog\n  Animal <|-- Dog',
};

/** The kind of diagram a text draws, from its first word, skipping comment lines, and front matter. */
export function kindOf(source: string): DiagramKind {
  const body = source.replace(/^\s*---[\s\S]*?---\s*/, '');
  const first =
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('%%')) ?? '';
  const word = first.split(/\s+/)[0].replace(/-v2$/, '').toLowerCase();
  if (word === 'flowchart' || word === 'graph') return 'flowchart';
  if (word === 'sequencediagram') return 'sequence';
  if (word === 'timeline') return 'timeline';
  if (word === 'classdiagram') return 'class';
  return 'other';
}

/** The text a reader without the feature sees: the diagram's own text in a code fence. */
export const fallbackOf = (source: string): string => `\`\`\`mermaid\n${source}\n\`\`\``;
