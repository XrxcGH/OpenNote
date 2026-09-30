// The sample document for the PDF export spike is a set of lecture notes. It has headings, body text in both
// bundled fonts, a table, a raster image, ink sketches, a block that must stay together, and page breaks.

export type Background = 'lined' | 'cornell' | 'dots' | 'plain';

/** Ink drawn over a block or a word after layout, anchored to where the text landed. */
export type Mark = 'underline' | 'star' | 'circle' | 'highlight' | 'note' | 'arrow';

export type Block =
  | { kind: 'title'; text: string; meta: string }
  | { kind: 'heading'; text: string; mark?: Mark }
  | { kind: 'paragraph'; text: string; reading?: boolean; circle?: string; highlight?: string; mark?: Mark }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'image'; caption: string }
  | { kind: 'sketch'; caption: string; seed: number; height: number }
  | { kind: 'code'; lines: string[] }
  | { kind: 'group'; blocks: Block[] }
  | { kind: 'break'; background: Background; cues?: string[]; summary?: string };

const LOG_COLUMNS = ['Week', 'Topic', 'Pages', 'Notes'];

const readingLog: string[][] = [
  ['1', 'Cell structure', 'pp. 12 to 40', 'Organelles and their jobs'],
  ['1', 'Microscopy', 'pp. 41 to 58', 'Light versus electron'],
  ['2', 'Lipids', 'pp. 59 to 77', 'Why bilayers form'],
  ['2', 'Membrane proteins', 'pp. 78 to 96', 'Channels, carriers, and pumps'],
  ['3', 'Diffusion', 'pp. 97 to 110', 'Fick law, worked examples'],
  ['3', 'Osmosis', 'pp. 111 to 124', 'Tonicity lab next week'],
  ['3', 'Active transport', 'pp. 125 to 139', 'ATP cost per cycle'],
  ['4', 'Cell signaling', 'pp. 140 to 162', 'Receptors and cascades'],
  ['4', 'Second messengers', 'pp. 163 to 175', 'cAMP and calcium'],
  ['5', 'Review', 'pp. 1 to 175', 'Practice exam on Friday'],
];

function firstSheet(): Block[] {
  return [
    { kind: 'title', text: 'Cell biology, week 3', meta: 'Lecture notes · Sep 30, 2026 · Room 204' },
    {
      kind: 'paragraph',
      text:
        'Today covered how cells move things across their membranes. The membrane lets small, uncharged ' +
        'molecules through on their own, but ions and large molecules need help from proteins. The key idea ' +
        'is that transport either follows a concentration gradient for free, or works against it and costs energy.',
      highlight: 'transport either follows a concentration gradient for free',
    },
    { kind: 'heading', text: 'Membrane transport', mark: 'star' },
    {
      kind: 'paragraph',
      reading: true,
      text:
        'Passive transport needs no energy from the cell. Simple diffusion moves oxygen and carbon dioxide ' +
        'straight through the lipid bilayer. Facilitated diffusion uses channel or carrier proteins, but ' +
        'still only moves molecules down their gradient, from high concentration to low.',
      circle: 'gradient',
    },
    {
      kind: 'list',
      items: [
        'Channels open a pore, which is fast and selective by size and charge.',
        'Carriers bind one molecule at a time and change shape to move it.',
        'Pumps use energy, usually from ATP, to move ions against the gradient.',
        'Vesicles carry large cargo in or out by endocytosis and exocytosis.',
      ],
    },
    { kind: 'image', caption: 'Figure 1. Cells under the microscope, drawn on a canvas and embedded as a PNG image.' },
    {
      kind: 'paragraph',
      reading: true,
      text:
        'Osmosis is the diffusion of water across a membrane that lets water through but not the solute. ' +
        'Water moves toward the side with more dissolved particles, so a red blood cell swells in pure water.',
      mark: 'note',
    },
  ];
}

function secondSheet(): Block[] {
  return [
    { kind: 'heading', text: 'Reading log', mark: 'underline' },
    { kind: 'table', columns: LOG_COLUMNS, rows: readingLog },
    { kind: 'heading', text: 'Lab protocol: tonicity' },
    {
      kind: 'code',
      lines: [
        'tube  solution      NaCl (%)  expected',
        'A     hypotonic     0.0       cells swell, burst',
        'B     isotonic      0.9       no net change',
        'C     hypertonic    3.0       cells shrink',
        'time  10 min at room temperature, then view at 400x',
      ],
    },
    {
      kind: 'paragraph',
      text:
        'Record the shape of 20 cells in each tube. Count how many burst, stay round, or shrink, and put ' +
        'the counts in the table in the lab book before the end of the session.',
      mark: 'arrow',
    },
    {
      kind: 'group',
      blocks: [
        { kind: 'heading', text: 'Diagram: the sodium-potassium pump' },
        {
          kind: 'sketch',
          caption: 'Sketch 1. Three sodium ions out, two potassium ions in, per ATP.',
          seed: 7,
          height: 300,
        },
        {
          kind: 'table',
          columns: ['Ion', 'Direction', 'Per cycle'],
          rows: [
            ['Sodium (Na+)', 'Out of the cell', '3'],
            ['Potassium (K+)', 'Into the cell', '2'],
            ['ATP', 'Used', '1'],
          ],
        },
      ],
    },
  ];
}

function thirdSheet(): Block[] {
  return [
    {
      kind: 'paragraph',
      reading: true,
      text:
        'The pump keeps the inside of the cell low in sodium and high in potassium. That difference powers ' +
        'other carriers, such as the glucose symporter, which lets sodium back in and brings glucose with it.',
    },
    {
      kind: 'break',
      background: 'cornell',
      cues: ['What sets the direction of passive transport?', 'Why does the pump need ATP?', 'Symport or antiport?'],
      summary:
        'Passive transport follows the gradient and needs no energy. Active transport, like the ' +
        'sodium-potassium pump, spends ATP to build gradients that other carriers then use.',
    },
    { kind: 'heading', text: 'Summary questions', mark: 'star' },
    {
      kind: 'paragraph',
      text:
        'Explain why oxygen crosses the membrane without help, but sodium ions do not. Use the words ' +
        'polarity, size, and charge in the answer.',
    },
    {
      kind: 'paragraph',
      reading: true,
      text:
        'Predict what happens to a plant cell in salt water. Draw the cell before and after, and label the ' +
        'membrane, the cell wall, and the vacuole.',
      circle: 'plant',
    },
    {
      kind: 'list',
      items: ['Hypotonic: water flows in.', 'Isotonic: no net flow.', 'Hypertonic: water flows out.'],
    },
  ];
}

/** After a manual page break, a sheet of dot grid paper for drawing. */
function sketchSheet(): Block[] {
  return [
    { kind: 'break', background: 'dots' },
    { kind: 'heading', text: 'Sketch page' },
    {
      kind: 'sketch',
      caption: 'Sketch 2. A cell membrane with channels, carriers, and a pump.',
      seed: 11,
      height: 560,
    },
    {
      kind: 'paragraph',
      text: 'Next week: cell signaling. Read pages 140 to 175 before the lecture, and bring the lab book.',
      mark: 'underline',
    },
  ];
}

/** The sample notes, about five sheets long, with every feature the spike checks. */
export function sampleNotes(): Block[] {
  return [...firstSheet(), ...secondSheet(), ...thirdSheet(), ...sketchSheet()];
}

/** A review section that repeats to fill long documents for the export timing runs. */
function review(index: number): Block[] {
  const blocks: Block[] = [
    { kind: 'heading', text: `Review session ${index}`, mark: index % 2 ? 'star' : 'underline' },
    {
      kind: 'paragraph',
      reading: index % 2 === 0,
      text:
        `Session ${index} went over the week's key terms again. Diffusion, osmosis, and active transport ` +
        'came up in every question, so the flash cards for them moved to the front of the deck.',
      highlight: 'moved to the front of the deck',
    },
    {
      kind: 'paragraph',
      text:
        'Work through each practice problem on paper first, then check the answer key. Mark the ones that ' +
        'took more than five minutes, and bring them to the next study group.',
    },
  ];
  if (index % 2 === 0) blocks.push({ kind: 'table', columns: LOG_COLUMNS, rows: readingLog.slice(0, 5) });
  if (index % 3 === 0) {
    blocks.push({ kind: 'sketch', caption: `Sketch for session ${index}.`, seed: 100 + index, height: 220 });
  }
  if (index % 5 === 0) blocks.push({ kind: 'image', caption: `Figure for session ${index}.` });
  return blocks;
}

/** The sample notes followed by enough review sections to fill `sheets` sheets. */
export function longDocument(sheets: number): Block[] {
  const blocks = sampleNotes();
  for (let index = 1; index <= sheets * 2 + 4; index++) blocks.push(...review(index));
  return blocks;
}
