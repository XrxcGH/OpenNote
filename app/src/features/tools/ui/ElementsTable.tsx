// The periodic table as a table: number, symbol, name, mass, group, family, and electron configuration. A family is
// told by its color and by its name in words. Insert puts the symbol, or the symbol with its configuration, at the caret.
import { t } from '../../../strings/t';
import type { Element } from '../reference/data';
import extra from './extra.module.css';
import { InsertButton } from './InsertButton';

export function ElementsTable({ elements }: { elements: readonly Element[] }) {
  return (
    <table className={extra.table}>
      <thead>
        <tr>
          <th scope="col">{t('study.reference.number')}</th>
          <th scope="col">{t('study.reference.symbol')}</th>
          <th scope="col">{t('study.reference.name')}</th>
          <th scope="col">{t('study.reference.mass')}</th>
          <th scope="col">{t('study.reference.groupNumber')}</th>
          <th scope="col">{t('study.reference.family')}</th>
          <th scope="col">{t('study.reference.configuration')}</th>
          <th scope="col">
            <span className={extra.hidden}>{t('study.reference.insert')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {elements.map((element) => (
          <tr key={element.number}>
            <td>{element.number}</td>
            <th scope="row">{element.symbol}</th>
            <td>{element.name}</td>
            <td>{element.mass}</td>
            <td>{element.groupNumber ?? t('study.reference.noGroup')}</td>
            <td>
              <span className={extra.dot} data-group={element.group} aria-hidden="true" />
              {t(`study.reference.groups.${element.group}`)}
            </td>
            <td>{element.configuration}</td>
            <td>
              <InsertButton text={element.symbol} label={t('study.reference.insertNamed', { name: element.name })} />
              <InsertButton
                text={`${element.symbol}: ${element.configuration}`}
                label={t('study.reference.insertConfiguration', { name: element.name })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
