// The tick marks and numbers of the ruler (text DESIGN.md 5.4), drawn as one SVG that is mirrored in a
// right-to-left paragraph.
import type { RulerBarProps } from './RulerBar';
import { TICKS, fromPoints } from './units';
import { defaultStops, pointsToPixels } from './geometry';
import styles from './ruler.module.css';

/** The tick marks, the numbers, and the default tab stops, from the left edge of the content box. */
export function Ticks({
  unit,
  zoom,
  width,
  rtl,
  tabs,
  defaultTab,
}: Pick<RulerBarProps, 'unit' | 'zoom' | 'width' | 'rtl' | 'tabs' | 'defaultTab'>) {
  const { major, parts } = TICKS[unit];
  const perMajor = major / fromPoints(1, unit);
  const count = Math.floor((width / perMajor) * parts);
  const marks = [];
  for (let i = 0; i <= count; i++) {
    const points = (i * perMajor) / parts;
    const whole = i % parts === 0;
    const half = parts % 2 === 0 && i % (parts / 2) === 0;
    const x = pointsToPixels(points, zoom);
    marks.push({
      x: rtl ? pointsToPixels(width, zoom) - x : x,
      size: whole ? 'major' : half ? 'half' : 'minor',
      label: whole && i > 0 ? String(Math.round(fromPoints(points, unit))) : undefined,
    });
  }
  const side = (points: number) => (rtl ? pointsToPixels(width - points, zoom) : pointsToPixels(points, zoom));
  const defaults = defaultTab === undefined ? [] : defaultStops(tabs, defaultTab, width);
  const top = { major: '55%', half: '70%', minor: '80%' } as const;
  return (
    <svg
      className={styles.ticks}
      aria-hidden="true"
      focusable="false"
      width={pointsToPixels(width, zoom)}
      height="100%"
    >
      {marks.map((mark) => (
        <g key={mark.x}>
          <line className={styles.tick} x1={mark.x} x2={mark.x} y1="100%" y2={top[mark.size as keyof typeof top]} />
          {mark.label && (
            <text className={styles.tickText} x={mark.x + (rtl ? -2 : 2)} y="50%" textAnchor={rtl ? 'end' : 'start'}>
              {mark.label}
            </text>
          )}
        </g>
      ))}
      {defaults.map((points) => (
        <line
          key={`d${points}`}
          className={styles.defaultTab}
          data-default-tab={points}
          x1={side(points)}
          x2={side(points)}
          y1="100%"
          y2="88%"
        />
      ))}
    </svg>
  );
}
