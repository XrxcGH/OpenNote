// Copy with inline CSS for Word and Docs (text program, Beta 10): the clipboard extension registers itself through
// editorExtensions, behind text.pasteFidelity. It loads right after start-up, so the editor stays out of the
// start-up bundle; the registry is read when an editor mounts.
void import('../../../editor/clipboard').catch(() => undefined);
