// Zotero citations and bibliographies in the page (Citation helper): the commands, and the answer to the Citations
// window. This file loads at start-up, so it holds only definitions; the editor work loads on first use.
import { commands } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { ZOTERO_EVENT } from '../../tools/flags';
import { targetEditor } from '../formattingBar/target';

const COMMANDS = [
  ['addEditCitation', 'study.citations.zotero.addCommand', 'Quotes'],
  ['addEditBibliography', 'study.citations.zotero.bibliographyCommand', 'Books'],
  ['refresh', 'study.citations.zotero.refreshCommand', 'ArrowsClockwise'],
  ['removeCodes', 'study.citations.zotero.unlinkCommand', 'LinkBreak'],
  ['setDocPrefs', 'study.citations.zotero.prefsCommand', 'GearSix'],
] as const;

async function run(command: (typeof COMMANDS)[number][0]): Promise<void> {
  const editor = targetEditor();
  if (!editor) return announce(t('study.citations.zotero.noPage'));
  const { zoteroCommand } = await import('../../citations');
  await zoteroCommand(command, editor);
}

for (const [command, title, icon] of COMMANDS) {
  commands.register({
    id: `citations.zotero.${command}`,
    title,
    keywords: 'study.citations.zotero.keywords',
    category: 'insert',
    icon,
    flag: 'tools.zotero',
    when: () => targetEditor() !== null,
    run: () => run(command),
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener(ZOTERO_EVENT, (event) => {
    const detail = (event as CustomEvent<{ command: (typeof COMMANDS)[number][0]; result?: Promise<void> }>).detail;
    if (detail && targetEditor()) detail.result = run(detail.command);
  });
}
