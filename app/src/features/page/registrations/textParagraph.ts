// Paragraph formatting in the editor (text program, Beta 9): the tab layout registers itself through
// editorExtensions, behind text.paraFormats. It loads right after start-up, so the editor stays out of the
// start-up bundle; the registry is read when an editor mounts.
void import('../../../editor/paragraph/tabLayout').catch(() => undefined);
// Block marks (border groups, list labels, scaled words) draw in every text editor, as the static render does.
void import('../../../editor/render/plugin').catch(() => undefined);
