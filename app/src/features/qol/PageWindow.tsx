// A page in a window of its own, beside the main window ("Open in new window"). It shows the page view alone, on
// the same notes as the main window, so an edit in either window shows in the other.

import { useEffect } from 'react';
import { useNotes } from '../../services/notes';
import { PageView } from '../page';
import { startTree, stopTree } from '../tree';
import styles from './PageWindow.module.css';

export default function PageWindow() {
  const notes = useNotes();
  useEffect(() => {
    void startTree(notes);
    return () => stopTree();
  }, [notes]);
  return (
    <main className={styles.window}>
      <PageView />
    </main>
  );
}
