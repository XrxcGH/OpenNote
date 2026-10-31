// Draws a kit Figure as SVG on theme colors. The same Figure becomes a one-ink SVG file for the page (figureSvg), so
// what is inserted matches what is shown. Words in the picture come from the strings; tones map to theme tokens.
import type { Figure, Paint, Shape, Tone } from './figure';
import { sayLabel } from './say';
import styles from './kit.module.css';

const STROKE: Record<Tone, string | undefined> = {
  ink: styles.sInk,
  muted: styles.sMuted,
  faint: styles.sFaint,
  accent: styles.sAccent,
  paper: styles.sPaper,
  none: undefined,
};

const FILL: Record<Tone, string | undefined> = {
  ink: styles.fInk,
  muted: styles.fMuted,
  faint: styles.fFaint,
  accent: styles.fAccent,
  paper: styles.fPaper,
  none: undefined,
};

function paint(shape: Paint, fallback: Tone) {
  const stroke = shape.stroke ?? fallback;
  const fill = shape.fill ?? 'none';
  return {
    className: [STROKE[stroke], FILL[fill]].filter(Boolean).join(' ') || undefined,
    fill: fill === 'none' ? 'none' : undefined,
    stroke: stroke === 'none' ? 'none' : undefined,
    strokeWidth: stroke === 'none' ? undefined : (shape.width ?? 1.5),
    strokeDasharray: shape.dash,
  };
}

function ShapeView({ shape }: { shape: Shape }) {
  switch (shape.kind) {
    case 'line':
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...paint(shape, 'ink')} />;
    case 'rect':
      return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} {...paint(shape, 'ink')} />;
    case 'circle':
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...paint(shape, 'ink')} />;
    case 'path':
      return <path d={shape.d} {...paint(shape, 'ink')} />;
    case 'text':
      return (
        <text
          x={shape.x}
          y={shape.y}
          fontSize={shape.size ?? 12}
          textAnchor={shape.anchor ?? 'start'}
          fontWeight={shape.bold ? 600 : undefined}
          transform={shape.rotate ? `rotate(${shape.rotate} ${shape.x} ${shape.y})` : undefined}
          className={[FILL[shape.tone ?? 'ink'], shape.mono ? styles.mono : ''].filter(Boolean).join(' ')}
        >
          {sayLabel(shape.label)}
        </text>
      );
  }
}

export function FigureView({ figure, label }: { figure: Figure; label: string }) {
  return (
    <svg
      className={styles.figure}
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      role="img"
      aria-label={label}
      style={{ maxInlineSize: `${figure.width}px` }}
    >
      {figure.shapes.map((shape, i) => (
        <ShapeView key={i} shape={shape} />
      ))}
    </svg>
  );
}
