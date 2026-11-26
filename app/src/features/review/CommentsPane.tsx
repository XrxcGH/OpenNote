// The comments pane (ADR 0086): the page's comments in reading order, each with the text it covers, its author and
// time, its text, and its replies. A comment can be answered, resolved, reopened, deleted, or followed to its text.
// The comment at the caret is marked. Comments are notes on their ranges for screen readers (text DESIGN.md 12).
import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { escapeParagraphText, parseTextBlock } from '../../editor/markdown';
import { currentLocale } from '../../state/language';
import { t } from '../../strings/t';
import { Button, IconButton, TextField } from '../../ui';
import { targetEditor } from '../page';
import { deleteComment, goToComment, setResolved } from './actions';
import { commentsAt } from './comments';
import type { PageComment, PageReview } from './page';
import { MAX_REPLIES, fitsRecord, stamp } from './records';
import type { CommentJson } from './records';
import { authorName, reviewPrefs, setReviewPrefs } from './state';
import styles from './review.module.css';

/** A record's inline Markdown as plain text, hard breaks as new lines. */
function plain(markdown: string): string {
  const doc = parseTextBlock(markdown);
  return doc.textBetween(0, doc.content.size, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''));
}

/** Plain text typed in the pane as inline Markdown. */
const markdownOf = (text: string) => escapeParagraphText(text.trim());

function when(time: string): string {
  const date = new Date(time);
  return Number.isNaN(date.getTime())
    ? time
    : date.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function Editor(props: { label: string; action: string; autoFocus?: boolean; onSubmit(text: string): void }) {
  const [text, setText] = useState('');
  const tooLong = !fitsRecord(markdownOf(text));
  const submit = () => {
    if (!text.trim() || tooLong) return;
    props.onSubmit(text);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };
  const helpId = useId();
  return (
    <div>
      <textarea
        className={styles.input}
        aria-label={props.label}
        aria-describedby={tooLong ? helpId : undefined}
        aria-invalid={tooLong || undefined}
        value={text}
        autoFocus={props.autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {tooLong && (
        <p id={helpId} className={styles.meta}>
          {t('textReview.tooLong')}
        </p>
      )}
      <Button variant="primary" disabled={!text.trim() || tooLong} onClick={submit}>
        {props.action}
      </Button>
    </div>
  );
}

function Item({ review, comment, active }: { review: PageReview; comment: PageComment; active: boolean }) {
  const { block, range, record } = comment;
  const id = range.id;
  const author = record?.author ?? t('textReview.unknownAuthor');
  const send = (patch: Partial<CommentJson>) => review.send(block, { comments: { [id]: patch } });
  const postText = (text: string) => send({ markdown: markdownOf(text) });
  const replies = record?.replies ?? [];
  const reply = (text: string) => {
    if (replies.length >= MAX_REPLIES) return;
    send({ replies: [...replies, { author: authorName(), time: stamp(), markdown: markdownOf(text) }] });
  };
  const labelId = `comment-${id}`;
  return (
    <li
      className={styles.comment}
      data-comment-item={id}
      data-active={active ? '' : undefined}
      data-resolved={record?.resolved ? '' : undefined}
      aria-labelledby={labelId}
    >
      <p id={labelId} className={styles.meta}>
        {t('textReview.commentLabel', { author })}
        {record ? ` · ${when(record.time)}` : ''}
        {record?.resolved ? ` · ${t('textReview.resolved')}` : ''}
      </p>
      <p className={styles.quote}>{t('textReview.on', { text: range.text })}</p>
      {record && record.markdown !== '' && <p className={styles.body}>{plain(record.markdown)}</p>}
      {record && record.markdown === '' && (
        <Editor label={t('textReview.commentText')} action={t('textReview.post')} onSubmit={postText} />
      )}
      {(record?.replies ?? []).map((one, index) => (
        <div key={index} className={styles.reply}>
          <p className={styles.meta}>{t('textReview.when', { author: one.author, time: when(one.time) })}</p>
          <p className={styles.body}>{plain(one.markdown)}</p>
        </div>
      ))}
      {record && record.markdown !== '' && !record.resolved && record.replies.length < MAX_REPLIES && (
        <Editor label={t('textReview.replyText')} action={t('textReview.reply')} onSubmit={reply} />
      )}
      {record && !record.resolved && record.replies.length >= MAX_REPLIES && (
        <p className={styles.meta}>{t('textReview.repliesFull')}</p>
      )}
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => goToComment(review, block, id)}>
          {t('textReview.goToText')}
        </Button>
        {record && (
          <Button variant="quiet" onClick={() => setResolved(review, block, id, !record.resolved)}>
            {t(record.resolved ? 'textReview.reopen' : 'textReview.resolve')}
          </Button>
        )}
        <Button variant="quiet" onClick={() => deleteComment(review, block, id)}>
          {t('textReview.delete')}
        </Button>
      </div>
    </li>
  );
}

/** The comment at the caret, if any. */
function activeComment(review: PageReview): string | null {
  const editor = targetEditor();
  if (!editor || editor.isDestroyed || !review.blockOf(editor)) return null;
  return commentsAt(editor.state.doc, editor.state.selection.from)[0] ?? null;
}

export function CommentsPane({ review, onClose }: { review: PageReview; onClose(): void }) {
  const [version, refresh] = useReducer((count: number) => count + 1, 0);
  const [active, setActive] = useState(() => activeComment(review));
  const [name, setName] = useState(reviewPrefs.get().author);
  useEffect(() => {
    const update = () => {
      refresh();
      setActive(activeComment(review));
    };
    const stops = [review.onChange(update), review.mounted.pool.onActiveChange(update)];
    // A caret move only changes which comment is marked. The list is read again only when the text changed.
    let shown = targetEditor()?.state.doc;
    const onSelection = () => {
      const doc = targetEditor()?.state.doc;
      if (doc !== shown) {
        shown = doc;
        refresh();
      }
      setActive(activeComment(review));
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      stops.forEach((stop) => stop());
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [review]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` counts the changes that make the list stale.
  const comments = useMemo(() => review.comments(), [review, version]);
  return (
    <section aria-labelledby="comments-pane-title">
      <div className={styles.header}>
        <h2 id="comments-pane-title" className={styles.title}>
          {t('textReview.pane')}
        </h2>
        <IconButton label={t('textReview.close')} icon={XIcon} onPress={onClose} />
      </div>
      <div className={styles.header}>
        <TextField
          label={t('textReview.yourName')}
          help={t('textReview.yourNameHelp')}
          value={name}
          onChange={(value) => {
            setName(value);
            setReviewPrefs({ author: value });
          }}
        />
      </div>
      {comments.length === 0 ? (
        <p className={styles.empty}>{t('textReview.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <Item key={comment.range.id} review={review} comment={comment} active={comment.range.id === active} />
          ))}
        </ul>
      )}
    </section>
  );
}
