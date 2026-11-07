// Paragraph formatting in the editor (text program, Beta 9): the tab layout registers itself through
// editorExtensions, behind text.paraFormats. It loads right after start-up, so the editor stays out of the
// start-up bundle; the registry is read when an editor mounts.
void import('../../../editor/paragraph/tabLayout').catch(() => undefined);
