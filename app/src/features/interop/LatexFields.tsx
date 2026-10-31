// The options of a LaTeX export and a live preview of the .tex text they would write (ADR 0054). The preview comes
// from the host, which runs the real export on the first pages, so it shows exactly what the file will say.

import { useId, useSyncExternalStore } from 'react';
import { RadioCard, RadioGroup, Switch, TextField } from '../../ui';
import { t } from '../../strings/t';
import type { ExportFlow, ExportState } from './exportFlow';
import styles from './Interop.module.css';
import { DEFAULT_LATEX } from './latex';
import { exportErrorText } from './text';

type Options = Extract<ExportState, { step: 'options' }>;

function Preview({ flow }: { flow: ExportFlow }) {
  const preview = useSyncExternalStore(flow.preview.subscribe, flow.preview.get);
  const id = useId();
  let body: string;
  switch (preview.status) {
    case 'ready':
      body = preview.text;
      break;
    case 'error':
      body = t('interopLatex.preview.failed', { detail: exportErrorText(preview.error) });
      break;
    case 'loading':
      body = t('interopLatex.preview.loading');
      break;
    case 'idle':
      body = t('interopLatex.preview.unavailable');
      break;
  }
  return (
    <div className={styles.previewBox}>
      <h4 id={id} className={styles.subheading}>
        {t('interopLatex.preview.heading')}
      </h4>
      <pre
        className={styles.preview}
        tabIndex={0}
        role="region"
        aria-labelledby={id}
        aria-busy={preview.status === 'loading'}
        lang="en"
      >
        {body}
      </pre>
      <p className={styles.note}>{t('interopLatex.preview.partial')}</p>
    </div>
  );
}

/** The LaTeX choices, shown below the format choice when LaTeX is the format. */
export function LatexFields({ flow, state }: { flow: ExportFlow; state: Options }) {
  const latex = state.latex ?? DEFAULT_LATEX;
  return (
    <div className={styles.fields}>
      <h3 className={styles.subheading}>{t('interopLatex.heading')}</h3>
      <RadioGroup
        label={t('interopLatex.engine.label')}
        columns={2}
        value={latex.engine}
        onChange={(engine) => flow.setLatex({ engine })}
      >
        <RadioCard value="unicode" label={t('interopLatex.engine.unicode')} />
        <RadioCard value="pdflatex" label={t('interopLatex.engine.pdflatex')} />
      </RadioGroup>
      <p className={styles.note}>{t('interopLatex.engine.help')}</p>
      <RadioGroup
        label={t('interopLatex.paper.label')}
        columns={2}
        value={latex.paper}
        onChange={(paper) => flow.setLatex({ paper })}
      >
        <RadioCard value="letter" label={t('interopLatex.paper.letter')} />
        <RadioCard value="a4" label={t('interopLatex.paper.a4')} />
      </RadioGroup>
      <RadioGroup
        label={t('interopLatex.margin.label')}
        columns={3}
        value={latex.margin}
        onChange={(margin) => flow.setLatex({ margin })}
      >
        <RadioCard value="narrow" label={t('interopLatex.margin.narrow')} />
        <RadioCard value="normal" label={t('interopLatex.margin.normal')} />
        <RadioCard value="wide" label={t('interopLatex.margin.wide')} />
      </RadioGroup>
      <Switch
        label={t('interopLatex.titleBlock')}
        checked={latex.titleBlock}
        onChange={(titleBlock) => flow.setLatex({ titleBlock })}
      />
      {latex.titleBlock && (
        <>
          <TextField
            label={t('interopLatex.author')}
            help={t('interopLatex.authorHelp')}
            value={latex.author}
            onChange={(author) => flow.setLatex({ author })}
          />
          <RadioGroup
            label={t('interopLatex.date.label')}
            columns={3}
            value={latex.date}
            onChange={(date) => flow.setLatex({ date })}
          >
            <RadioCard value="none" label={t('interopLatex.date.none')} />
            <RadioCard value="today" label={t('interopLatex.date.today')} />
            <RadioCard value="edited" label={t('interopLatex.date.edited')} />
          </RadioGroup>
        </>
      )}
      <Switch label={t('interopLatex.toc')} checked={latex.toc} onChange={(toc) => flow.setLatex({ toc })} />
      <p className={styles.note}>{t('interopLatex.note')}</p>
      <Preview flow={flow} />
    </div>
  );
}
