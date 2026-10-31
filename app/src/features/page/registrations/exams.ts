// Practice exams (ADR 0052): a paper made from the open page, its section, or its notebook. It is taken and marked
// in the Practice exams window. The commands read the notes, and protected pages stay out (ADR 0042). This file loads
// at start-up, so it holds only definitions; the feature loads on first use.
import { defineCommand } from '../../../commands/registry';
import type { CommandContext } from '../../../commands/types';
import { commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { currentNode, currentSection, getNode, isProtectedNode, notebookOf, treeStore } from '../../tree';
import { shownMounted } from '../pagesApi';
import { editingSettingsParts } from '../registries';
import { addCommand } from './qolStudy';
import { say } from './say';

// The Settings switch turns the commands off on this device; it is read here, without loading the feature.
const EXAMS_OFF = 'opennote.study.exams';
function examsChosen(): boolean {
  try {
    return window.localStorage.getItem(EXAMS_OFF) !== 'off';
  } catch {
    return true;
  }
}

type ExamScope = 'page' | 'section' | 'notebook';
type Study = typeof import('../../study');

/** Between the text blocks of a page, as in its Markdown. */
const PARAGRAPH = '\n\n';

/** Says why there is no exam, for the commands below. */
function refuse(key: MessageKey): false {
  say(t(key));
  return false;
}

const locked = (id: string): boolean => isProtectedNode(treeStore.get(), id);

/** The shown page's text as typed so far. Returns false, after saying why, when there is none to use. */
async function pageRequest(study: Study): Promise<boolean> {
  const mounted = shownMounted.get();
  if (!mounted) return refuse('exams.command.noPage');
  if (locked(mounted.page.id)) return refuse('exams.command.protected');
  const { liveBlock } = await import('../blocks/textBlock');
  const text = mounted.layer
    .blocks()
    .filter((block) => block.type === 'text')
    .map((block) => String(liveBlock(mounted.layer, block).data.markdown ?? '').trim())
    .filter(Boolean)
    .join(PARAGRAPH);
  if (!text.trim()) return refuse('exams.command.emptyPage');
  const title = mounted.page.initial.title || t('study.deck.untitled', { number: 1 });
  study.requestExam({
    scope: 'page',
    title,
    sources: [{ pageId: mounted.page.id, title, text }],
    skipped: 0,
    notebookId: notebookOf(treeStore.get(), mounted.page.id),
  });
  return true;
}

/** The pages of the current section or notebook. Returns false, after saying why, when there are none to use. */
async function notesRequest(ctx: CommandContext, study: Study, scope: 'section' | 'notebook'): Promise<boolean> {
  const tree = treeStore.get();
  const node = currentNode(ctx);
  const root = scope === 'section' ? currentSection(ctx) : getNode(node ? (notebookOf(tree, node.id) ?? '') : '');
  if (!root) return refuse(scope === 'section' ? 'exams.command.noSection' : 'exams.command.noNotebook');
  const list = await study.pagesUnder(ctx.notes, root.id, study.examSectionTitle());
  const read = await study.readPages(ctx.platform.pages, list, locked);
  if (read.sources.length === 0) return refuse('exams.command.emptyNotes');
  study.requestExam({ scope, title: root.title, ...read, notebookId: notebookOf(tree, root.id) });
  return true;
}

async function startExam(ctx: CommandContext, scope: ExamScope): Promise<void> {
  if (!examsChosen()) return void say(t('exams.command.off'));
  const study = await import('../../study');
  const ready = scope === 'page' ? await pageRequest(study) : await notesRequest(ctx, study, scope);
  if (ready) (await import('../../tools')).openTool('exam');
}

for (const [scope, id, title] of [
  ['page', 'study.examPage', 'exams.command.page'],
  ['section', 'study.examSection', 'exams.command.section'],
  ['notebook', 'study.examNotebook', 'exams.command.notebook'],
] as const) {
  commands.register(
    defineCommand({
      id,
      title,
      keywords: 'exams.command.keywords',
      category: 'general',
      icon: 'Exam',
      flag: 'study.exams',
      when: () => examsChosen(),
      run: (ctx) => startExam(ctx, scope),
    }),
  );
}
/** The exam the shown page keeps for a retake (study/exam/stored.ts), read without loading the feature. */
function shownExam(): unknown {
  const view = shownMounted.get()?.page.initial.view as Record<string, unknown> | undefined;
  return view?.practiceExam;
}

/** Opens a fresh copy of the exam saved on the shown page: its paper, its answer key, or its results. */
async function retakeExam(): Promise<void> {
  if (!examsChosen()) return void say(t('exams.command.off'));
  const mounted = shownMounted.get();
  const study = await import('../../study');
  const exam = study.readStoredExam(mounted?.page.initial.view);
  if (!mounted || !exam) return void say(t('exams.command.noRetake'));
  study.requestRetake(exam, notebookOf(treeStore.get(), mounted.page.id));
  (await import('../../tools')).openTool('exam');
  say(t('exams.retake.ready', { title: exam.title }));
}

commands.register(
  defineCommand({
    id: 'study.examRetake',
    title: 'exams.command.retake',
    keywords: 'exams.command.keywords',
    category: 'general',
    icon: 'Exam',
    flag: 'study.exams',
    // Offered on a saved exam's pages only.
    when: () => examsChosen() && shownExam() !== undefined,
    run: () => retakeExam(),
  }),
);
contextMenus.register({
  id: 'tree.section.study.exam',
  menu: 'tree.section',
  command: 'study.examSection',
  group: 'qol',
  order: 41,
  flag: 'study.exams',
});
addCommand({
  id: 'tools.exam',
  title: 'exams.command.open',
  keywords: 'exams.command.keywords',
  category: 'general',
  icon: 'Exam',
  flag: 'study.exams',
  anywhere: true,
  run: async () => (await import('../../tools')).openTool('exam'),
});
editingSettingsParts.register({
  id: 'study.exams',
  title: 'exams.settings.title',
  order: 45,
  flag: 'study.exams',
  load: () => import('../../study').then((study) => study.loadExamSettings()),
});
