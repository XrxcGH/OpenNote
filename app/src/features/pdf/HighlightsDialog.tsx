// The highlights of a PDF (A3-19): every highlight on the section's pages of that PDF, by color and then by page. Each
// one opens its spot, and the whole list copies or saves as Markdown.
import { useEffect, useState } from 'react';
import type { Platform } from '../../platform/types';
import type { NodeId, NotesService } from '../../services/notes/types';
import type { BlockJson } from '../../services/pages/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, showToast } from '../../ui';
import { groupHighlights, highlightsMarkdown, highlightsOf } from './highlights';
import type { FoundHighlight } from './highlights';
import { pdfOf } from './model';
import styles from './pdf.module.css';

export interface HighlightsDialogProps {
  platform: Platform;
  notes: NotesService;
  section: NodeId;
  /** Only this PDF's highlights, or every PDF's when null. */
  file: string | null;
}

/** The highlights on one page's PDF pictures. */
export function foundOn(node: string, blocks: readonly BlockJson[], file: string | null): FoundHighlight[] {
  const found: FoundHighlight[] = [];
  for (const block of blocks) {
    const pdf = pdfOf(block);
    if (!pdf || (file !== null && pdf.file !== file)) continue;
    for (const highlight of highlightsOf(block)) {
      found.push({ ...highlight, file: pdf.file, page: pdf.page, node, block: block.id });
    }
  }
  return found;
}

async function collect(props: HighlightsDialogProps): Promise<FoundHighlight[]> {
  const pages = (await props.notes.listChildren(props.section)).filter((node) => node.kind === 'page');
  const found: FoundHighlight[] = [];
  for (const node of pages) {
    const page = await props.platform.pages.open(node.id as never, { viewport: null });
    try {
      found.push(...foundOn(node.id, page.initial.blocks, props.file));
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return found;
}

export default function HighlightsDialog(props: HighlightsDialogProps & OverlayProps) {
  const { onClose, platform, notes, file } = props;
  const [found, setFound] = useState<FoundHighlight[] | null>(null);
  useEffect(() => {
    let live = true;
    void collect(props).then((list) => live && setFound(list));
    return () => {
      live = false;
    };
    // The dialog reads the section once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = file ? t('pdf.highlights.titleFor', { file }) : t('pdf.highlights.title');
  const markdown = () => highlightsMarkdown(title, found ?? []);
  const copy = async () => {
    await navigator.clipboard.writeText(markdown());
    showToast({ message: t('pdf.highlights.copied') });
  };
  const save = async () => {
    const folder = await platform.interop.pick('folder', null);
    if (!folder || !platform.interop.more) return;
    const saved = await platform.interop.more<{ path: string }>('save_text', {
      folder,
      name: file ? t('pdf.highlights.fileName', { file: file.replace(/\.pdf$/i, '') }) : t('pdf.highlights.title'),
      text: markdown(),
    });
    showToast({ message: t('pdf.highlights.saved', { path: saved.path }) });
  };
  const open = async (item: FoundHighlight) => {
    onClose();
    const { openAndReveal } = await import('../search');
    await openAndReveal(notes, item.node, item.block);
  };

  const groups = groupHighlights(found ?? []);
  return (
    <Dialog
      title={title}
      size="medium"
      onDismiss={onClose}
      actions={[
        { id: 'close', label: t('common.close'), variant: 'secondary', onPress: onClose, leastDestructive: true },
      ]}
    >
      {found === null ? <p role="status">{t('pdf.highlights.loading')}</p> : null}
      {found !== null && found.length === 0 ? <p>{t('pdf.highlights.empty')}</p> : null}
      {groups.map((group) => (
        <section key={group.color} aria-labelledby={`pdf-hl-${group.color}`}>
          <h3 id={`pdf-hl-${group.color}`}>
            <span className={styles.swatch} data-color={group.color} aria-hidden="true" />
            {t(`pdf.highlights.colors.${group.color}`)}
          </h3>
          <ul className={styles.found}>
            {group.items.map((item) => (
              <li key={item.id}>
                <Button variant="quiet" onClick={() => void open(item)}>
                  {t('pdf.highlights.item', { page: item.page, text: item.text })}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {found && found.length > 0 ? (
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => void copy()}>
            {t('pdf.highlights.copy')}
          </Button>
          {platform.interop.more ? (
            <Button variant="secondary" onClick={() => void save()}>
              {t('pdf.highlights.save')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
