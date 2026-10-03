// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_PLAIN_LINES,
  bulletsOf,
  changeFromMerge,
  changelogSection,
  changesBetween,
  markdownNotes,
  parseLog,
  plainLine,
  plainNotes,
  previousTag,
  type Change,
} from './notes.ts';
import { compareVersions } from './versions.ts';

const CHANGELOG = `# Changelog

## [Unreleased]

- Not released yet.

## [1.0.0] - 2026-11-01

### Notes

- Write **typed notes** with [links](https://example.com) and \`code\`.
- Draw with a pen.

### Fixes

* Fixed a crash on start-up.

## [0.9.0] - 2026-10-01

- Older.

[Unreleased]: https://github.com/XrxcGH/OpenNote/compare/v1.0.0...main
`;

describe('compareVersions', () => {
  it('orders versions by number, and a prerelease before its release', () => {
    const ordered = [
      '0.9.0',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.10.0',
      '2.0.0',
    ];
    for (let at = 1; at < ordered.length; at++) {
      expect(compareVersions(ordered[at - 1], ordered[at]), `${ordered[at - 1]} < ${ordered[at]}`).toBe(-1);
      expect(compareVersions(ordered[at], ordered[at - 1])).toBe(1);
    }
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0);
  });

  it('refuses text that is not a version', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow('not a semantic version');
    expect(() => compareVersions('v1.0.0', '1.0.0')).toThrow('not a semantic version');
  });
});

describe('changelogSection', () => {
  it('finds the section for a version, with or without brackets, and stops at the next heading', () => {
    const section = changelogSection(CHANGELOG, '1.0.0');
    expect(section).toContain('### Notes');
    expect(section).toContain('Fixed a crash');
    expect(section).not.toContain('Older');
    expect(section).not.toContain('compare/');
    expect(changelogSection('## 0.5.0\n\n- A thing.\n', '0.5.0')).toBe('- A thing.');
  });

  it('does not mistake one version for the start of another', () => {
    expect(changelogSection(CHANGELOG, '1.0')).toBeUndefined();
    expect(changelogSection('## [1.0.0-beta.1]\n\n- Beta.\n', '1.0.0')).toBeUndefined();
  });

  it('has no section for a version that is missing or empty', () => {
    expect(changelogSection(CHANGELOG, '3.0.0')).toBeUndefined();
    expect(changelogSection('## [1.0.0]\n\n## [0.9.0]\n- Older\n', '1.0.0')).toBeUndefined();
  });
});

describe('plain text', () => {
  it('removes links, emphasis, code marks, and bullets', () => {
    expect(plainLine('- Write **typed notes** with [links](https://example.com) and `code`.')).toBe(
      'Write typed notes with links and code.',
    );
  });

  it('lists only the bullets of a section', () => {
    expect(bulletsOf(changelogSection(CHANGELOG, '1.0.0') ?? '')).toEqual([
      'Write typed notes with links and code.',
      'Draw with a pen.',
      'Fixed a crash on start-up.',
    ]);
  });
});

describe('changeFromMerge', () => {
  it('reads a GitHub pull request merge from its body', () => {
    expect(changeFromMerge('a1', 'Merge pull request #12 from XrxcGH/phase-3', 'add storage\n\nMore text.')).toEqual({
      sha: 'a1',
      pr: 12,
      text: 'Add storage',
    });
  });

  it('reads a local merge named for its branch', () => {
    expect(changeFromMerge('b2', 'Merge phase-2: app shell and navigation', '')).toEqual({
      sha: 'b2',
      text: 'App shell and navigation',
    });
    expect(changeFromMerge('c3', 'Merge the verified corrections to ADR 0006', '')?.text).toBe(
      'The verified corrections to ADR 0006',
    );
  });

  it('skips merges that only bring a branch up to date', () => {
    for (const subject of [
      "Merge branch 'main' into phase-3",
      'Merge main into phase-3',
      'Merge remote-tracking branch x',
    ]) {
      expect(changeFromMerge('d4', subject, ''), subject).toBeUndefined();
    }
  });
});

describe('previousTag', () => {
  const tags = ['v0.9.0', 'v1.0.0-beta.1', 'v1.0.0-beta.2', 'v1.0.0', 'v1.1.0-beta.1', 'v1.1.0'];

  it('looks back to the previous stable release for a stable release', () => {
    expect(previousTag(tags, 'v1.1.0')).toBe('v1.0.0');
    expect(previousTag(tags, 'v1.0.0')).toBe('v0.9.0');
  });

  it('looks back to the previous release of any kind for a prerelease', () => {
    expect(previousTag(tags, 'v1.0.0-beta.2')).toBe('v1.0.0-beta.1');
    expect(previousTag(tags, 'v1.1.0-beta.1')).toBe('v1.0.0');
  });

  it('has no previous tag for the first release, or for a tag that is not yet made', () => {
    expect(previousTag(tags, 'v0.9.0')).toBeUndefined();
    expect(previousTag(tags, 'v2.0.0')).toBe('v1.1.0');
  });
});

describe('the release page', () => {
  const changes: Change[] = [
    { sha: 'a', text: 'Add storage', pr: 12 },
    { sha: 'b', text: 'App shell' },
  ];

  it('shows what is new, the downloads, and all changes', () => {
    const page = markdownNotes({ tag: 'v1.0.0', changelog: CHANGELOG, changes, previous: 'v0.9.0' });
    expect(page).toContain("## What's new");
    expect(page).toContain('### Notes');
    expect(page).toContain('| 64-bit Windows, on most PCs | `OpenNote_Windows64.exe` |');
    expect(page).toContain('| Windows on Arm, such as Snapdragon laptops | `OpenNote_WindowsARM64.exe` |');
    expect(page).toContain('<summary>All changes (2)</summary>');
    expect(page).toContain('- Add storage ([#12](https://github.com/XrxcGH/OpenNote/pull/12))');
    expect(page).toContain('compare/v0.9.0...v1.0.0');
  });

  it('shows angle brackets in a commit subject as text, not as an HTML tag', () => {
    const page = markdownNotes({ tag: 'v1.0.0', changes: [{ sha: 'a', text: 'Name files OpenNote_<OS spec>' }] });
    expect(page).toContain('- Name files OpenNote_&lt;OS spec&gt;');
  });

  it('still reads well with no changelog entry and no changes', () => {
    const page = markdownNotes({ tag: 'v1.0.0', changes: [] });
    expect(page).toContain('## OpenNote 1.0.0');
    expect(page).not.toContain('<details>');
  });
});

describe('the update notice', () => {
  it('lists the changelog bullets', () => {
    expect(plainNotes({ tag: 'v1.0.0', changelog: CHANGELOG, changes: [] })).toBe(
      'Write typed notes with links and code.\nDraw with a pen.\nFixed a crash on start-up.',
    );
  });

  it('falls back to the merged changes, then to the tag', () => {
    expect(plainNotes({ tag: 'v2.0.0', changelog: CHANGELOG, changes: [{ sha: 'a', text: 'Add storage' }] })).toBe(
      'Add storage',
    );
    expect(plainNotes({ tag: 'v2.0.0', changelog: CHANGELOG, changes: [] })).toBe('OpenNote v2.0.0');
  });

  it('fits in the lines the notice can show, with a link to the rest', () => {
    const many = Array.from({ length: 20 }, (_, at) => `- Change ${at + 1}.`).join('\n');
    const text = plainNotes({ tag: 'v1.0.0', changelog: `## [1.0.0]\n\n${many}\n`, changes: [] });
    const lines = text.split('\n');
    expect(lines).toHaveLength(MAX_PLAIN_LINES);
    expect(lines[0]).toBe('Change 1.');
    expect(lines.at(-2)).toBe('And 14 more.');
    expect(lines.at(-1)).toBe('Full notes: https://github.com/XrxcGH/OpenNote/releases/tag/v1.0.0');
  });

  it('gives up on the list when it is too big for the updater', () => {
    const huge = `- ${'word '.repeat(2000)}.`;
    expect(plainNotes({ tag: 'v1.0.0', changelog: `## [1.0.0]\n\n${huge}\n`, changes: [] })).toBe(
      'OpenNote v1.0.0\nFull notes: https://github.com/XrxcGH/OpenNote/releases/tag/v1.0.0',
    );
  });
});

describe('parseLog', () => {
  it('reads records of hash, subject, and body', () => {
    const log = 'h1\x1fMerge phase-1: spikes\x1f\x1e\nh2\x1fMerge main into phase-1\x1f\x1e\nh3\x1fadd x\x1f\x1e';
    expect(parseLog(log, true).map((change) => change.text)).toEqual(['Spikes', 'Add x']);
    expect(parseLog(log, false).map((change) => change.text)).toHaveLength(3);
  });
});

describe('changesBetween, in a real repository', { timeout: 60_000 }, () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  function repository(): string {
    const dir = mkdtempSync(join(tmpdir(), 'opennote-notes-'));
    dirs.push(dir);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      );
    git('init', '-q', '-b', 'main');
    const commit = (file: string, message: string) => {
      writeFileSync(join(dir, file), file);
      git('add', file);
      git('commit', '-q', '-m', message);
    };
    const merge = (branch: string, file: string, message: string) => {
      git('switch', '-q', '-c', branch);
      commit(file, `work on ${file}`);
      git('switch', '-q', 'main');
      git('merge', '-q', '--no-ff', branch, '-m', message);
    };
    commit('a', 'first');
    merge('p1', 'one', 'Merge phase-1: spikes');
    git('tag', 'v0.1.0');
    merge('p2', 'two', 'Merge phase-2: app shell');
    merge('p3', 'three', 'Merge pull request #7 from XrxcGH/p3\n\nAdd the document model');
    return dir;
  }

  it('lists the merges since the previous tag, newest first', () => {
    const changes = changesBetween('v0.1.0', 'HEAD', repository());
    expect(changes.map((change) => change.text)).toEqual(['Add the document model', 'App shell']);
    expect(changes[0].pr).toBe(7);
  });

  it('lists every merge when there is no previous tag', () => {
    expect(changesBetween(undefined, 'HEAD', repository()).map((change) => change.text)).toHaveLength(3);
  });
});
