// Settings, Fonts: the substitution table. Each font a document uses that this device lacks gets a row, and the
// person picks the stand-in, as in Word's Font Substitution. The choice is a device setting.
import { useId } from 'react';
import { t } from '../../strings/t';
import { setSubstitution } from './recent';
import { resolveFont } from './service';
import type { FontCatalog } from './service';
import styles from './fonts.module.css';

export interface FontSubstitutionsProps {
  catalog: FontCatalog;
  /** The font names the open notebook uses, so the table lists the ones that are missing. */
  used: readonly string[];
}

function SubstitutionRow({ name, catalog }: { name: string; catalog: FontCatalog }) {
  const chosen = Object.entries(catalog.substitutions).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const automatic = resolveFont(name, { ...catalog, substitutions: {} });
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>
        <select
          aria-label={t('textFonts.subStandInFor', { name })}
          value={chosen?.[1] ?? ''}
          onChange={(event) => setSubstitution(name, event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('textFonts.subAutomatic', { standIn: automatic.standIn ?? '' })}</option>
          {catalog.families.map((one) => (
            <option key={one.name} value={one.name}>
              {one.name}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

export function FontSubstitutions({ catalog, used }: FontSubstitutionsProps) {
  const titleId = useId();
  const names = [...new Set(used)].filter((name) => !catalog.has(name) && !name.startsWith('+'));
  return (
    <section className={styles.subs} aria-labelledby={titleId}>
      <h3 id={titleId}>{t('textFonts.subTitle')}</h3>
      <p>{t('textFonts.subIntro')}</p>
      {names.length === 0 ? (
        <p role="status">{t('textFonts.subNone')}</p>
      ) : (
        <table aria-label={t('textFonts.subTable')}>
          <thead>
            <tr>
              <th scope="col">{t('textFonts.subMissing')}</th>
              <th scope="col">{t('textFonts.subStandIn')}</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => (
              <SubstitutionRow key={name} name={name} catalog={catalog} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
