// Calendars and eras: type a date in any of thirteen calendars and see it in all of them with the steps, list the
// festivals of a year, and keep an era table for reign eras.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { attempt, errorText, num } from '../ui/attempt';
import {
  Check,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertBar,
  Note,
  Problem,
  Results,
  Steps,
  Tabs,
  Tool,
  ht,
} from '../ui/parts';
import { SYSTEMS, isoText, rowsFor, stepsFor, toJdn, westernText } from './convert';
import type { DateInput, System } from './convert';
import { festivals } from './festivals';
import { jdnToGregorian } from './jdn';
import { parseEras } from './others';

type Tab = 'convert' | 'festivals' | 'eras';
const TABS: readonly Tab[] = ['convert', 'festivals', 'eras'];
const c = 'kitHumanities.calendars';

function ConvertPanel({ eras }: { eras: string }) {
  const [input, setInput] = useState<DateInput>({
    system: 'gregorian',
    year: '2024',
    month: '10',
    day: '3',
    leap: false,
    text: '',
  });
  const set = (patch: Partial<DateInput>) => setInput({ ...input, ...patch });
  const result = attempt(() => {
    const jdn = toJdn(input);
    const table = attempt(() => parseEras(eras));
    return { jdn, rows: rowsFor(jdn, table.ok ? table.value : []), steps: stepsFor(jdn) };
  });
  const single = input.system === 'maya' || input.system === 'jdn';
  return (
    <>
      <Fields>
        <Choice<System>
          label={t(`${c}.system`)}
          value={input.system}
          options={SYSTEMS.map((id) => ({ value: id, label: ht(`calendars.systems.${id}`) }))}
          onChange={(system) => set({ system })}
        />
        {single ? (
          <Field
            label={input.system === 'maya' ? t(`${c}.longCount`) : t(`${c}.jdnField`)}
            value={input.text}
            onChange={(text) => set({ text })}
            hint={input.system === 'maya' ? t(`${c}.longCountHint`) : undefined}
          />
        ) : (
          <>
            <Field
              label={t(`${c}.year`)}
              value={input.year}
              onChange={(year) => set({ year })}
              numeric
              hint={input.system === 'gregorian' || input.system === 'julian' ? t(`${c}.yearHint`) : undefined}
            />
            <Field label={t(`${c}.month`)} value={input.month} onChange={(month) => set({ month })} numeric />
            <Field label={t(`${c}.day`)} value={input.day} onChange={(day) => set({ day })} numeric />
            {input.system === 'chinese' ? (
              <Check label={t(`${c}.leapMonth`)} checked={input.leap} onChange={(leap) => set({ leap })} />
            ) : null}
          </>
        )}
      </Fields>
      {result.ok ? (
        <>
          <Results label={t(`${c}.results`)} rows={result.value.rows} />
          {input.system.startsWith('islamic') ? <Note>{t(`${c}.islamicNote`)}</Note> : null}
          <Note>{t(`${c}.source`)}</Note>
          <Steps steps={result.value.steps} />
          <InsertBar
            payloads={{
              answer: `${westernText(jdnToGregorian(result.value.jdn))}: ${result.value.rows
                .slice(6)
                .map(([name, value]) => `${name} ${value}`)
                .join('; ')}`,
              table: {
                header: [t('kitHumanities.common.quantity'), t('kitHumanities.common.value')],
                rows: result.value.rows,
              },
              steps: result.value.steps,
            }}
          />
        </>
      ) : (
        <Problem text={errorText('calendars', result.code)} />
      )}
    </>
  );
}

function FestivalsPanel() {
  const [year, setYear] = useState('2025');
  const result = attempt(() => {
    const value = num(year);
    if (!Number.isInteger(value)) throw new Error('whole');
    return { year: value, list: festivals(value) };
  });
  const header = (['name', 'date', 'calendar'] as const).map((key) => ht(`calendars.festivalHeader.${key}`));
  const rows = result.ok
    ? result.value.list.map((item) => [
        ht(`calendars.feast.${item.key}`),
        isoText(item.jdn),
        ht(`calendars.festivalCalendar.${item.calendar}`),
      ])
    : [];
  return (
    <>
      <Fields>
        <Field label={t(`${c}.festivalYear`)} value={year} onChange={setYear} numeric />
      </Fields>
      {result.ok ? (
        <>
          <DataTable caption={t(`${c}.festivals`, { year: String(result.value.year) })} header={header} rows={rows} />
          <Note>{t(`${c}.islamicNote`)}</Note>
          <InsertBar payloads={{ table: { header, rows } }} />
        </>
      ) : (
        <Problem text={errorText('calendars', result.code)} />
      )}
    </>
  );
}

function ErasPanel({ text, setText }: { text: string; setText(next: string): void }) {
  const parsed = attempt(() => parseEras(text));
  return (
    <>
      <Field label={t(`${c}.erasLabel`)} value={text} onChange={setText} rows={6} mono hint={t(`${c}.erasHint`)} />
      {parsed.ok ? null : <Problem text={errorText('calendars', parsed.code)} />}
      <Note>{t(`${c}.erasNote`)}</Note>
    </>
  );
}

export function CalendarsTool() {
  const [tab, setTab] = useState<Tab>('convert');
  const [eras, setEras] = useState(() => ht('calendars.erasExample'));
  return (
    <Tool label={t(`${c}.title`)}>
      <Tabs<Tab>
        label={t(`${c}.modes`)}
        items={TABS.map((id) => ({ id, label: ht(`calendars.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'convert' ? <ConvertPanel eras={eras} /> : null}
      {tab === 'festivals' ? <FestivalsPanel /> : null}
      {tab === 'eras' ? <ErasPanel text={eras} setText={setEras} /> : null}
    </Tool>
  );
}
