// Text with its matched words in bold as well as color, so a match never depends on color alone.
import { pieces } from '../../services/search/text';
import type { ByteRange } from '../../services/search/types';
import styles from './search.module.css';

export function Highlighted({ text, ranges }: { text: string; ranges: readonly ByteRange[] }) {
  return (
    <>
      {pieces(text, ranges).map((piece, at) =>
        piece.match ? (
          <strong key={at} className={styles.match}>
            {piece.text}
          </strong>
        ) : (
          <span key={at}>{piece.text}</span>
        ),
      )}
    </>
  );
}
