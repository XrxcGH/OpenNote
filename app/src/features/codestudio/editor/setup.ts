// The editor's fixed CodeMirror setup (DESIGN 5.3), the completion list host, and the keys of the registry's code.*
// commands as CodeMirror sees them.

import {
  autocompletion,
  clearSnippet,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  nextSnippetField,
  prevSnippetField,
  snippet,
  snippetKeymap,
} from '@codemirror/autocomplete';
import type { Completion, CompletionContext as CmContext, CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { isEnabled } from '../../../app/flags';
import { chordMatches } from '../../../commands/chords';
import { keysFor } from '../../../commands/keymap';
import type { CommandContext, CommandDef } from '../../../commands/types';
import { getSettings } from '../../../state/settings';
import type { CompletionSource, ProjectLanguage } from '../contracts';
import { CODE_EDITOR_COMMANDS } from './commands';
import { ghostField, thinkingField } from './ghost';
import { debugGutter, markExtensions } from './marks';
import { problemExtensions } from './problems';

/** Gutters, history, selection, brackets, search, snippets, and the default keymaps. */
export function editingExtensions(onBreakpointToggle?: (line: number) => void): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    codeFolding(),
    debugGutter(onBreakpointToggle),
    problemExtensions,
    history({ newGroupDelay: 500 }),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of((event) => event.altKey && !event.shiftKey),
    rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
    crosshairCursor({ key: 'Alt' }),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    // Tab no longer moves between snippet fields: Enter and Shift+Enter do (DESIGN 5.3).
    snippetKeymap.of([
      { key: 'Enter', run: nextSnippetField },
      { key: 'Shift-Enter', run: prevSnippetField },
      { key: 'Escape', run: clearSnippet },
    ]),
    ghostField,
    thinkingField,
    markExtensions,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
    ]),
  ];
}

/** Where the completion list's sources come from, read when the list opens. */
export interface CompletionHost {
  sources(): readonly CompletionSource[];
  language(): string;
  file(): string;
}

async function complete(host: CompletionHost, context: CmContext): Promise<CompletionResult | null> {
  const sources = host.sources();
  if (sources.length === 0) return null;
  const word = context.matchBefore(/[\p{L}\p{N}_$]*/u);
  const from = word?.from ?? context.pos;
  const before = from > 0 ? context.state.sliceDoc(from - 1, from) : '';
  if (!context.explicit && from === context.pos && before !== '.') return null;
  const request = {
    language: host.language() as ProjectLanguage,
    file: host.file(),
    text: context.state.doc.toString(),
    pos: context.pos,
    word: { from, to: context.pos, text: context.state.sliceDoc(from, context.pos) },
    explicit: context.explicit,
  };
  const lists = await Promise.all(sources.map((source) => Promise.resolve(source.complete(request)).catch(() => [])));
  const items = lists.flat().sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const options: Completion[] = items.map((item, index) => ({
    label: item.label,
    detail: item.detail,
    type: item.kind,
    boost: Math.max(-99, 99 - index),
    apply: item.snippet ? snippet(item.insert ?? item.label) : (item.insert ?? item.label),
  }));
  return options.length ? { from, options } : null;
}

/** The completion list: the sources' items in score order. Its default keys are off; Ctrl+Tab accepts. */
export function completionExtension(host: CompletionHost): Extension {
  return autocompletion({
    override: [(context) => complete(host, context)],
    activateOnTyping: getSettings().code.completionList,
    defaultKeymap: false,
    icons: false,
  });
}

// The registry's code.* commands read nothing from their context.
const NO_CONTEXT = {} as CommandContext;

function available(def: CommandDef): boolean {
  if (def.flag && !isEnabled(def.flag)) return false;
  return (!def.when || def.when(NO_CONTEXT)) && (!def.enabled || def.enabled(NO_CONTEXT));
}

/** The code.* commands a key press names now, from keysFor, so a remap applies at once. */
export function commandMatcher(): (event: KeyboardEvent) => CommandDef[] {
  const table = new Map<string, CommandDef[]>();
  for (const def of CODE_EDITOR_COMMANDS) {
    for (const key of keysFor(def.id)) table.set(key, [...(table.get(key) ?? []), def]);
  }
  return (event) => chordMatches(event).flatMap(({ chord }) => table.get(chord) ?? []);
}

/**
 * Runs a code.* command for a press the app's dispatcher did not run: no dispatcher, or a chord such as Ctrl+Right
 * that stays with text fields. It runs once and stops the key.
 */
export function registryKeys(matching: (event: KeyboardEvent) => CommandDef[]): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event) => {
        if (event.defaultPrevented) return false;
        const def = matching(event).find(available);
        if (!def) return false;
        event.preventDefault();
        event.stopPropagation();
        void def.run(NO_CONTEXT, undefined);
        return true;
      },
    }),
  );
}
