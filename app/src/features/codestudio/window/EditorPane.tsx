// One code editor (code:L01) per open tab; only the active one shows, so each keeps its own undo history, caret,
// and scroll. The editor's chunk loads with the first tab. Typing goes to the project store, which sends it to
// the page when typing pauses.
import { useEffect, useRef } from 'react';
import { t } from '../../../strings/t';
import type { CodeEditor } from '../editor/create';
import type { StudioController } from './controller';
import { fileLanguage } from './languages';
import styles from './studio.module.css';

interface SlotProps {
  controller: StudioController;
  id: string;
  shown: boolean;
  /** The project's open count: a slot of the project before never shows the next one. */
  generation: number;
}

function EditorSlot({ controller, id, shown, generation }: SlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const path = controller.pathOf(id);
  useEffect(() => {
    let editor: CodeEditor | null = null;
    let gone = false;
    const cursor = () => {
      if (!editor) return;
      const head = editor.view.state.selection.main.head;
      const line = editor.view.state.doc.lineAt(head);
      controller.setCursor({ line: line.number, column: head - line.from + 1 });
    };
    void import('../editor').then(({ createCodeEditor }) => {
      const file = controller.project()?.files[id];
      if (gone || !host.current || !file) return;
      editor = createCodeEditor(host.current, {
        language: fileLanguage(file.path),
        text: file.text,
        label: t('codeStudio.studio.editorLabel', { name: file.path }),
        file: file.path,
        onChange: (text) => {
          controller.edited(id, text);
          cursor();
        },
        // Escape in the editor stops a run and arms "Tab leaves" (DESIGN 5.3.1); it never reaches the tool window,
        // which would close the studio. Escape from outside the editor still closes it.
        onEscape: () => {
          if (controller.running) controller.stop();
          return true;
        },
      });
      for (const type of ['keyup', 'pointerup', 'focusin'] as const) editor.view.dom.addEventListener(type, cursor);
      controller.attachEditor(id, editor);
    });
    return () => {
      gone = true;
      if (editor && controller.detachEditor(id, editor)) editor.destroy();
    };
  }, [controller, id, path, generation]);
  return <div ref={host} className={styles.editorSlot} hidden={!shown} data-file={path} />;
}

export function EditorPane({ controller }: { controller: StudioController }) {
  return (
    <div className={styles.editor}>
      {controller.tabs.map((id) => (
        <EditorSlot
          key={`${controller.generation}:${id}`}
          controller={controller}
          id={id}
          shown={controller.activeFile === id}
          generation={controller.generation}
        />
      ))}
      {controller.tabs.length === 0 && <p className={styles.empty}>{t('codeStudio.studio.noFileOpen')}</p>}
    </div>
  );
}
