// WP5's registrations for paste (PLAN.md section 2, rule 3): Copy as Markdown and the Paste settings part. Paste,
// drop, and copy listen on the page view itself (images/attach.ts), and the pipeline loads on first use.
import { registerPageCommand } from '../keys';
import { editingSettingsParts } from '../registries';
import { shownMedia } from '../images/shown';

registerPageCommand({
  id: 'edit.copyAsMarkdown',
  title: 'paste.copyAsMarkdown',
  keywords: 'paste.copyAsMarkdownKeywords',
  category: 'editing',
  flag: 'page.editor',
  when: () => shownMedia.get() !== null,
  run: () => import('../images/commands').then((module) => module.copyAsMarkdown()),
});

editingSettingsParts.register({
  id: 'paste',
  title: 'paste.settings.title',
  order: 60,
  load: () => import('../settings/EditingPaste'),
});
