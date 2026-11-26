// How the page draws a code project block: the card in a React root, over a project store. Run and Open in Code
// studio name the block for the studio window and open it; Export saves the .zip; Import adds files through the
// store, so the limits hold and one undo takes the import back.
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { exportZip, entriesOf, importSummary, planImport } from './exchange';
import { projectFallback } from './fallback';
import { canEdit, readProject } from './model';
import { ProjectCard } from './ProjectCard';
import { createProjectStore } from './store';
import { setStudioTarget } from './studioTarget';
import { ZipError } from './zip';

export interface CodeProjectBlockProps {
  block: string;
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>, fallback?: string): void;
  announce(text: string): void;
}

/** A file name for the export, from the project's name. */
function zipName(name: string): string {
  const cleaned = [...name].map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? ' ' : char));
  return `${cleaned.join('').trim().slice(0, 80) || t('codeStudio.project.block')}.zip`;
}

export function mountCodeProject(container: HTMLElement, initial: CodeProjectBlockProps) {
  const root = createRoot(container);
  let props = initial;
  let status = '';
  const store = createProjectStore({
    data: initial.data,
    readOnly: initial.readOnly,
    patch: (data, fallback) => props.patch(data, fallback),
  });

  const say = (text: string) => {
    status = text;
    props.announce(text);
    draw();
  };

  const open = async (run: boolean) => {
    store.flush();
    setStudioTarget({ block: props.block, run });
    (await import('../../tools')).openTool('code');
  };

  const save = async () => {
    const project = store.project();
    const name = zipName(project.name);
    try {
      const { saveBytes } = await import('../../study');
      const bytes = exportZip(project);
      if (await saveBytes(name, t('codeStudio.project.exchange.zipLabel'), bytes, 'application/zip')) {
        say(t('codeStudio.project.exchange.exported', { name }));
      }
    } catch {
      say(t('codeStudio.project.exchange.exportFailed'));
    }
  };

  const load = async (files: File[]) => {
    try {
      const picked = await Promise.all(
        files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
      );
      const plan = planImport(store.project(), await entriesOf(picked));
      if (plan.patch) {
        const done = store.apply(plan.patch);
        if (!done.ok) return say(done.message);
      }
      say(importSummary(plan));
    } catch (error) {
      const key =
        error instanceof ZipError
          ? error.code === 'tooBig'
            ? 'codeStudio.project.exchange.zipTooBig'
            : 'codeStudio.project.exchange.notZip'
          : 'codeStudio.project.exchange.importFailed';
      say(t(key));
    }
  };

  function draw() {
    const newer = !canEdit(props.data);
    const project = store.project();
    root.render(
      <ProjectCard
        project={project}
        readOnly={props.readOnly || newer}
        newer={newer}
        fallback={newer ? projectFallback(readProject(props.data)) : ''}
        status={status}
        onRun={() => void open(true)}
        onOpen={() => void open(false)}
        onExport={() => void save()}
        onImport={(files) => void load(files)}
      />,
    );
  }

  draw();
  return {
    update(next: CodeProjectBlockProps) {
      props = next;
      store.update(next.data, next.readOnly);
      draw();
    },
    destroy() {
      store.dispose();
      setTimeout(() => root.unmount(), 0);
    },
  };
}
