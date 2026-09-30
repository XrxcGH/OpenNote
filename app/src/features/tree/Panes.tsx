// WP0's placeholder panes: plain lists of the notebooks with their sections, and of the current section's pages.
// Choosing an item navigates to it. WP6 replaces them with TreeView.

import { navigate, useLocation } from '../../app/location';
import type { NodeId, NodeSummary } from '../../services/notes';
import { t } from '../../strings/t';
import styles from './Panes.module.css';
import { useNotesQuery } from './useNotesQuery';

type Workspace = Extract<ReturnType<typeof useLocation>, { view: 'workspace' }>;

function useWorkspace(): Workspace {
  const location = useLocation();
  return location.view === 'workspace'
    ? location
    : { view: 'workspace', notebookId: null, sectionId: null, pageId: null };
}

function Item(props: { node: NodeSummary; current: boolean; onChoose(): void }) {
  return (
    <li>
      <button
        type="button"
        className={styles.item}
        aria-current={props.current ? 'true' : undefined}
        onClick={props.onChoose}
      >
        {props.node.title}
      </button>
    </li>
  );
}

function Sections({ notebook, where }: { notebook: NodeSummary; where: Workspace }) {
  const sections = useNotesQuery(notebook.id, (notes) => notes.listChildren(notebook.id)) ?? [];
  return (
    <ul className={styles.list}>
      {sections.map((section) => (
        <Item
          key={section.id}
          node={section}
          current={section.id === where.sectionId}
          onChoose={() =>
            section.kind === 'section' &&
            navigate({ view: 'workspace', notebookId: notebook.id, sectionId: section.id, pageId: null })
          }
        />
      ))}
    </ul>
  );
}

export function NotebooksPane() {
  const where = useWorkspace();
  const notebooks = useNotesQuery('notebooks', (notes) => notes.listNotebooks());
  if (notebooks?.length === 0) return <p className={styles.empty}>{t('tree.empty.notebooks')}</p>;
  return (
    <ul className={styles.list}>
      {(notebooks ?? []).map((notebook) => (
        <li key={notebook.id}>
          <span className={styles.heading}>{notebook.title}</span>
          <Sections notebook={notebook} where={where} />
        </li>
      ))}
    </ul>
  );
}

export function PagesPane() {
  const where = useWorkspace();
  const sectionId = where.sectionId;
  const pages = useNotesQuery(sectionId, (notes) => notes.listChildren(sectionId as NodeId));
  if (!sectionId) return <p className={styles.empty}>{t('tree.empty.noSection')}</p>;
  if (pages?.length === 0) return <p className={styles.empty}>{t('tree.empty.pagesNoShortcut')}</p>;
  return (
    <ul className={styles.list}>
      {(pages ?? []).map((page) => (
        <Item
          key={page.id}
          node={page}
          current={page.id === where.pageId}
          onChoose={() => navigate({ ...where, pageId: page.id })}
        />
      ))}
    </ul>
  );
}
