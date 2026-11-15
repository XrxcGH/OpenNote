// The command bar's icons for Insert, View, and Draw. They load with the tab panel (commandIcons.ts holds Home), so
// start-up carries only the Home icons. The Draw table holds the four Draw tools that Toolbar.tsx draws itself; the
// two buttons of the shapes library are imported by DrawShapes.tsx in the ink chunk.

import type { IconComponent } from './icons';
import { ArrowsOutLineHorizontalIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal';
import { ArrowsOutSimpleIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutSimple';
import { BezierCurveIcon } from '@phosphor-icons/react/dist/csr/BezierCurve';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { CalendarCheckIcon } from '@phosphor-icons/react/dist/csr/CalendarCheck';
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock';
import { CodeIcon } from '@phosphor-icons/react/dist/csr/Code';
import { CrosshairIcon } from '@phosphor-icons/react/dist/csr/Crosshair';
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/csr/DeviceMobile';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link';
import { ListDashesIcon } from '@phosphor-icons/react/dist/csr/ListDashes';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/csr/LockSimple';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassPlus';
import { MarkdownLogoIcon } from '@phosphor-icons/react/dist/csr/MarkdownLogo';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { NotebookIcon } from '@phosphor-icons/react/dist/csr/Notebook';
import { NotepadIcon } from '@phosphor-icons/react/dist/csr/Notepad';
import { PaperclipIcon } from '@phosphor-icons/react/dist/csr/Paperclip';
import { QuotesIcon } from '@phosphor-icons/react/dist/csr/Quotes';
import { RulerIcon } from '@phosphor-icons/react/dist/csr/Ruler';
import { ShapesIcon } from '@phosphor-icons/react/dist/csr/Shapes';
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table';
import { VideoCameraIcon } from '@phosphor-icons/react/dist/csr/VideoCamera';

export const LAZY_ICONS: Readonly<Record<string, IconComponent>> = {
  'format.link': LinkIcon,
  'block.codeBlock': CodeIcon,
  'block.callout': QuotesIcon,
  'block.divider': MinusIcon,
  'templates.insert': NotepadIcon,
  'insert.attachFile': PaperclipIcon,
  'media.insertVideo': VideoCameraIcon,
  'insert.date': CalendarBlankIcon,
  'insert.time': ClockIcon,
  'insert.dateTime': CalendarCheckIcon,
  'insert.table': TableIcon,
  'insert.fromPhone': DeviceMobileIcon,
  'layout.toggleNotebooks': NotebookIcon,
  'layout.togglePages': FilesIcon,
  'layout.paneWidths': ArrowsOutLineHorizontalIcon,
  'nav.revealInTree': CrosshairIcon,
  'outline.showAll': ArrowsOutSimpleIcon,
  'page.toc': ListDashesIcon,
  'page.markdownSource': MarkdownLogoIcon,
  'page.lockForReading': BookOpenTextIcon,
  'view.ruler': RulerIcon,
  'ink.inkToShape': ShapesIcon,
  'ink.curve.make': BezierCurveIcon,
  'ink.zoomBox': MagnifyingGlassPlusIcon,
  'ink.canvasLock': LockSimpleIcon,
};
