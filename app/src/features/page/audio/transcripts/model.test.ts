import { describe, expect, it } from 'vitest';
import {
  actionText,
  clockMs,
  fromSegments,
  markdownOf,
  momentHref,
  nextSpeaker,
  outlineOf,
  parseMomentHref,
  parseStamp,
  parseTranscript,
  quoteContent,
  taskContent,
  quoteMarkdown,
  recapMarkdown,
  removeRange,
  renameSpeaker,
  setLineSpeaker,
  shiftBy,
  speakerName,
  speakersOf,
  splitAt,
} from './model';
import type { TranscriptData } from './model';

const word = (n: number) => `Speaker ${n}`;

function sample(): TranscriptData {
  return {
    ...fromSegments(
      'rec1',
      [
        { startMs: 0, endMs: 4000, text: 'Welcome everyone.', speaker: 1 },
        { startMs: 4000, endMs: 9000, text: 'Thanks, shall we start with the budget?', speaker: 2 },
        { startMs: 9000, endMs: 15000, text: 'The secret code is 4417.', speaker: 1 },
        { startMs: 15000, endMs: 20000, text: 'Back to the agenda.', speaker: 2 },
      ],
      'engine',
    ),
    summary: 'A meeting about the budget and a code.',
    chapters: [{ startMs: 0, endMs: 20000, title: 'Budget' }],
  };
}

describe('times', () => {
  it('shows minutes and seconds, and hours when there are some', () => {
    expect(clockMs(65_000)).toBe('1:05');
    expect(clockMs(3_725_000)).toBe('1:02:05');
  });

  it('reads SRT, WebVTT, and plain stamps', () => {
    expect(parseStamp('00:01:02,500')).toBe(62_500);
    expect(parseStamp('1:02.5')).toBe(62_500);
    expect(parseStamp('62')).toBe(62_000);
    expect(parseStamp('nope')).toBeNull();
  });
});

describe('speakers', () => {
  it('renames one speaker for every line, and an empty name goes back to the default', () => {
    const data = renameSpeaker(sample(), 1, '  Dr. Patel ');
    expect(speakerName(data, 1, word)).toBe('Dr. Patel');
    expect(speakerName(data, 2, word)).toBe('Speaker 2');
    expect(markdownOf(data, word)).toContain('[0:09] Dr. Patel: The secret code is 4417.');
    expect(speakerName(renameSpeaker(data, 1, ''), 1, word)).toBe('Speaker 1');
  });

  it('lists the speakers and finds the next free number', () => {
    const data = sample();
    expect(speakersOf(data)).toEqual([1, 2]);
    expect(nextSpeaker(data)).toBe(3);
    const first = data.lines[0].id;
    expect(setLineSpeaker(data, first, undefined).lines[0].speaker).toBeUndefined();
    expect(setLineSpeaker(data, first, 3).lines[0].speaker).toBe(3);
  });
});

describe('removing a part of the audio', () => {
  it('drops the lines it overlaps, moves later ones earlier, and clears the summary and chapters', () => {
    const data = removeRange(sample(), 8000, 12000);
    expect(data.lines.map((line) => line.text)).toEqual(['Welcome everyone.', 'Back to the agenda.']);
    expect(JSON.stringify(data)).not.toContain('4417');
    expect(data.lines[1].startMs).toBe(11000);
    expect(data.summary).toBe('');
    expect(data.chapters).toEqual([]);
  });

  it('keeps the summary when the part held no words', () => {
    const quiet = { ...sample(), lines: sample().lines.slice(0, 1) };
    const data = removeRange(quiet, 5000, 8000);
    expect(data.lines).toHaveLength(1);
    expect(data.summary).toBe(sample().summary);
  });
});

describe('trimming', () => {
  it('moves every line and chapter earlier by what was cut from the start, never before zero', () => {
    const data = shiftBy(sample(), -5000);
    expect(data.lines.map((line) => line.startMs)).toEqual([0, 0, 4000, 10_000]);
    expect(data.chapters[0].startMs).toBe(0);
  });
});

describe('splitting', () => {
  it('gives each half its lines, and the second half starts from zero', () => {
    const [one, two] = splitAt(sample(), 9000);
    expect(one.lines).toHaveLength(2);
    expect(two.lines.map((line) => line.startMs)).toEqual([0, 6000]);
  });
});

describe('reading a transcript from text', () => {
  it('reads captions', () => {
    const srt =
      '1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:03,500 --> 00:00:05,000\nSecond <i>cue</i>\n';
    const { segments, timed } = parseTranscript(srt, 10_000);
    expect(timed).toBe(true);
    expect(segments).toEqual([
      { startMs: 1000, endMs: 3000, text: 'Hello there' },
      { startMs: 3500, endMs: 5000, text: 'Second cue' },
    ]);
  });

  it('reads lines that start with a time, and joins a wrapped line to the one before', () => {
    const { segments } = parseTranscript('[0:05] First thing\nstill the first\n[1:10] Second thing', 90_000);
    expect(segments).toEqual([
      { startMs: 5000, endMs: 70_000, text: 'First thing still the first' },
      { startMs: 70_000, endMs: 90_000, text: 'Second thing' },
    ]);
  });

  it('spreads plain paragraphs over the recording by length', () => {
    const { segments, timed } = parseTranscript('aaaa\n\nbbbbbbbb', 12_000);
    expect(timed).toBe(false);
    expect(segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
      [0, 4000],
      [4000, 12_000],
    ]);
  });
});

describe('copying lines into the notes', () => {
  it('quotes the chosen lines with a link to each moment, and the speaker when asked', () => {
    const data = renameSpeaker(sample(), 2, 'Maria');
    const ids = new Set([data.lines[1].id]);
    const node = quoteContent(data, ids, { includeSpeaker: true, fallback: word });
    expect(node).toEqual({
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '0:04', marks: [{ type: 'link', attrs: { href: 'opennote:moment/rec1#4000' } }] },
            { type: 'text', text: ' Maria: Thanks, shall we start with the budget?' },
          ],
        },
      ],
    });
    expect(JSON.stringify(quoteContent(data, ids, { includeSpeaker: false, fallback: word }))).not.toContain('Maria');
    expect(quoteContent(data, new Set(), { includeSpeaker: false, fallback: word })).toBeNull();
    expect(quoteMarkdown(data, ids, { includeSpeaker: false, fallback: word })).toBe(
      '> [0:04](opennote:moment/rec1#4000) Thanks, shall we start with the budget?',
    );
  });

  it('makes a checkbox with a link to the moment', () => {
    const node = taskContent('rec1', 61_000, 'Send the budget');
    expect(node.content?.[0].attrs).toEqual({ checked: false });
    expect(JSON.stringify(node)).toContain('opennote:moment/rec1#61000');
  });

  it('round-trips a moment link', () => {
    expect(parseMomentHref(momentHref('rec1', 4000.4))).toEqual({ recording: 'rec1', ms: 4000 });
    expect(parseMomentHref('https://example.com')).toBeNull();
  });
});

describe('the recap', () => {
  const recap = {
    summary: 'We agreed on the plan.',
    decisions: ['Ship on Friday'],
    actions: [{ text: 'Send the budget', owner: 'Maria', due: 'by Friday' }],
    headings: ['Budget'],
  };
  const words = { summary: 'Summary', decisions: 'Decisions', actions: 'Action items', headings: 'Headings' };

  it('writes only the parts chosen', () => {
    const all = recapMarkdown(recap, { summary: true, decisions: true, actions: true, headings: false }, words);
    expect(all).toContain('## Decisions\n\n- Ship on Friday');
    expect(all).toContain('- [ ] Send the budget (Maria, by Friday)');
    const some = recapMarkdown(recap, { summary: true, decisions: false, actions: false, headings: false }, words);
    expect(some).toBe('## Summary\n\nWe agreed on the plan.');
  });

  it('reads the headings and open checkboxes of a page without intelligence', () => {
    const out = outlineOf(['# Plan\ntext', '- [ ] Call Sam\n- [x] Done thing\n## Next']);
    expect(out).toEqual({ headings: ['Plan', 'Next'], tasks: ['Call Sam'] });
  });

  it('names who and when only when they are known', () => {
    expect(actionText({ text: 'Call', owner: null, due: null })).toBe('Call');
  });
});
