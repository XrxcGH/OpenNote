// The Add note space and Make handouts dialogs (A2-20): where the space goes or how many to a page, ruled or blank
// paper, and which pages. Every choice is a radio group, so the arrow keys move through it.
import { useState } from 'react';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Dialog, RadioCard, RadioGroup, TextField } from '../../ui';
import { addNoteSpace, makeHandouts } from './actions';
import type { Scope, ToolDeps } from './actions';
import type { Paper, PerSheet, Side } from './noteSpace';

export interface PdfToolsDialogProps {
  tool: 'noteSpace' | 'handouts';
  deps: ToolDeps;
}

type ScopeKind = Scope['kind'];

function scopeOf(kind: ScopeKind, from: string, to: string): Scope | null {
  if (kind !== 'range') return { kind };
  const a = Number.parseInt(from, 10);
  const b = Number.parseInt(to, 10);
  return Number.isInteger(a) && Number.isInteger(b) && a > 0 && b > 0 ? { kind, from: a, to: b } : null;
}

export default function PdfToolsDialog({ tool, deps, onClose }: PdfToolsDialogProps & OverlayProps) {
  const [side, setSide] = useState<Side>('right');
  const [perSheet, setPerSheet] = useState<'2' | '3'>('3');
  const [paper, setPaper] = useState<Paper>('ruled');
  const [kind, setKind] = useState<ScopeKind>(tool === 'noteSpace' ? 'page' : 'all');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('1');
  const [busy, setBusy] = useState(false);
  const scope = scopeOf(kind, from, to);

  const run = async () => {
    if (!scope || busy) return;
    setBusy(true);
    try {
      if (tool === 'noteSpace') await addNoteSpace(deps, scope, side, paper);
      else await makeHandouts(deps, scope, Number(perSheet) as PerSheet, paper);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t(`pdf.${tool}.title`)}
      description={t(`pdf.${tool}.description`)}
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: onClose, leastDestructive: true },
        { id: 'run', label: t(`pdf.${tool}.run`), variant: 'primary', onPress: run },
      ]}
    >
      {tool === 'noteSpace' ? (
        <RadioGroup<Side> label={t('pdf.noteSpace.side')} value={side} onChange={setSide}>
          {(['right', 'bottom', 'both'] as const).map((value) => (
            <RadioCard<Side> key={value} value={value} label={t(`pdf.noteSpace.sides.${value}`)} />
          ))}
        </RadioGroup>
      ) : (
        <RadioGroup<'2' | '3'> label={t('pdf.handouts.perSheet')} value={perSheet} onChange={setPerSheet}>
          {(['2', '3'] as const).map((value) => (
            <RadioCard<'2' | '3'> key={value} value={value} label={t('pdf.handouts.count', { count: Number(value) })} />
          ))}
        </RadioGroup>
      )}
      <RadioGroup<Paper> label={t('pdf.paper.label')} value={paper} onChange={setPaper}>
        <RadioCard<Paper> value="ruled" label={t('pdf.paper.ruled')} />
        <RadioCard<Paper> value="blank" label={t('pdf.paper.blank')} />
      </RadioGroup>
      <RadioGroup<ScopeKind> label={t('pdf.scope.label')} value={kind} onChange={setKind}>
        <RadioCard<ScopeKind> value="page" label={t('pdf.scope.page')} />
        <RadioCard<ScopeKind> value="range" label={t('pdf.scope.range')} />
        <RadioCard<ScopeKind> value="all" label={t('pdf.scope.all')} description={t('pdf.scope.allHelp')} />
      </RadioGroup>
      {kind === 'range' ? (
        <>
          <TextField label={t('pdf.scope.from')} value={from} onChange={setFrom} />
          <TextField
            label={t('pdf.scope.to')}
            value={to}
            onChange={setTo}
            error={scope ? undefined : t('pdf.scope.invalid')}
            onCommit={() => void run()}
          />
        </>
      ) : null}
    </Dialog>
  );
}
