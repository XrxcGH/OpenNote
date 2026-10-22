// The templates that come with OpenNote (flag doc.problemTemplates): a problem set with Given, Find, Solution, and
// Answer, Cornell notes, and a lab report. They appear in the new-page chooser beside the person's own templates, and
// they are filled in like any template: {{title}} and {{date}} become the page's title and today's date.
import { t } from '../../strings/t';
import type { BlockJson } from '../../services/pages/types';

export const BUILTIN_PREFIX = 'builtin:';

export type BuiltinId = 'problem-set' | 'cornell' | 'lab-report';

export const BUILTIN_IDS: readonly BuiltinId[] = ['problem-set', 'cornell', 'lab-report'];

export const isBuiltin = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);

const idOf = (id: string): BuiltinId | null => {
  const name = id.slice(BUILTIN_PREFIX.length);
  return BUILTIN_IDS.find((one) => one === name) ?? null;
};

export function builtinTitle(id: BuiltinId): string {
  return t(
    id === 'problem-set'
      ? 'docStructure.template.problemSet'
      : id === 'cornell'
        ? 'docStructure.template.cornell'
        : 'docStructure.template.labReport',
  );
}

/** One problem: Given, Find, Solution (a numbered list, so Practice mode can hide its steps), and Answer. */
const problem = (number: number, level: '#' | '##'): string[] => [
  `${level} ${t('docStructure.template.problem', { number })}`,
  '',
  `${level}# ${t('docStructure.template.given')}`,
  '',
  '- ',
  '',
  `${level}# ${t('docStructure.template.find')}`,
  '',
  '- ',
  '',
  `${level}# ${t('docStructure.template.solution')}`,
  '',
  '1. ',
  '',
  `${level}# ${t('docStructure.template.answer')}`,
  '',
  '',
];

function markdownOf(id: BuiltinId): string {
  const k = (key: Parameters<typeof t>[0]) => t(key);
  if (id === 'problem-set') {
    return ['# {{title}}', '', `${t('docStructure.template.names')}: {{cursor}}`, '', ...problem(1, '##'), ...problem(2, '##')]
      .join('\n')
      .trimEnd();
  }
  if (id === 'cornell') {
    return [
      '# {{title}}',
      '',
      `${k('docStructure.template.date')}: {{date}}`,
      '',
      `${k('docStructure.template.topic')}: `,
      '',
      `## ${k('docStructure.template.cues')}`,
      '',
      '- {{cursor}}',
      '',
      `## ${k('docStructure.template.notes')}`,
      '',
      '',
      `## ${k('docStructure.template.summary')}`,
      '',
    ]
      .join('\n')
      .trimEnd();
  }
  const sections = [
    'purpose',
    'hypothesis',
    'materials',
    'procedure',
    'data',
    'analysis',
    'uncertainty',
    'conclusion',
    'references',
  ] as const;
  return [
    '# {{title}}',
    '',
    `${k('docStructure.template.names')}: {{cursor}}`,
    `${k('docStructure.template.date')}: {{date}}`,
    '',
    ...sections.flatMap((name) => [`## ${k(`docStructure.template.${name}`)}`, '', '']),
  ]
    .join('\n')
    .trimEnd();
}

/** The built-in template with this ID as page blocks, or null when there is none. */
export function builtinBlocks(id: string): BlockJson[] | null {
  const name = idOf(id);
  if (!name) return null;
  const now = new Date().toISOString();
  return [
    {
      id: `${BUILTIN_PREFIX}${name}` as BlockJson['id'],
      type: 'text',
      order: 'a0',
      created: now,
      modified: now,
      data: { markdown: markdownOf(name) },
    },
  ];
}

/** The built-in templates for the new-page chooser. */
export function builtinInfos(): { id: string; title: string }[] {
  return BUILTIN_IDS.map((name) => ({ id: `${BUILTIN_PREFIX}${name}`, title: builtinTitle(name) }));
}
