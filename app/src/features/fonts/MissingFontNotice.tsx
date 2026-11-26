// The notice for a font this device lacks: "(not installed: showing Carlito)". It names the stand-in, so a person
// knows what the page draws with while the document keeps the original name.
import { t } from '../../strings/t';
import type { ResolvedFont } from './service';
import styles from './fonts.module.css';

export function MissingFontNotice({ font, id }: { font: ResolvedFont; id?: string }) {
  if (font.installed || font.standIn === null) return null;
  return (
    <span id={id} className={styles.notice}>
      {t('textFonts.notInstalled', { standIn: font.standIn })}
    </span>
  );
}
