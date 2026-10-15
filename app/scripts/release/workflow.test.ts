// @vitest-environment node
// Checks the safety rules of .github/workflows/release.yml. No YAML parser is installed, so these tests read the
// file by its layout: jobs at 2 spaces, job settings at 4, steps as list items at 6.
//
// They catch the mistakes that matter most for a workflow that signs and publishes. Examples are a secret in the
// wrong step, an action that is not pinned, a dry run that can publish, and untrusted text pasted into a script.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_FILES, REPO } from '../write-manifest.ts';
import { SBOM_FILE, hashOutput } from './check-downloads.ts';

const workflowFile = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', name), 'utf8');
const WORKFLOW = workflowFile('release.yml');
const CI = workflowFile('ci.yml');

/** The text of each job, by name. */
function jobsOf(text: string): Record<string, string> {
  const body = text.slice(text.indexOf('\njobs:\n') + 7);
  const parts = body.split(/^ {2}(?=[a-z][\w-]*:\s*$)/m).filter(Boolean);
  return Object.fromEntries(parts.map((part) => [part.slice(0, part.indexOf(':')), part]));
}

/** The text of each step of a job, in order. */
function stepsOf(job: string): string[] {
  return job.split(/^ {6}- /m).slice(1);
}

/** The script of each step of a job that has one. */
function scriptsOf(job: string): string[] {
  return stepsOf(job)
    .map((step) => step.split(/^ {8}run: ?/m)[1]?.split(/^ {8}\S/m)[0])
    .filter((script): script is string => script !== undefined)
    .map((script) => script.replace(/^[|>][-+]?\n/, ''));
}

const jobs = jobsOf(WORKFLOW);
const names = Object.keys(jobs);
const stepNamed = (job: string, title: string) => {
  const step = stepsOf(jobs[job]).find((candidate) =>
    candidate.split('\n').some((line) => line.trim().startsWith(`name: ${title}`)),
  );
  if (!step) throw new Error(`No step "${title}" in ${job}.`);
  return step;
};

describe('release.yml triggers', () => {
  it('runs for version tags, and by hand as a dry run', () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}push:\n {4}tags: \['v\*'\]\n {2}workflow_dispatch:\n/m);
  });

  it('has these jobs', () => {
    expect(names).toEqual(['version', 'checklist', 'ci', 'build', 'sbom', 'package', 'update-test', 'publish']);
  });

  it('only waits for jobs that exist, and a job never waits for itself', () => {
    for (const [name, job] of Object.entries(jobs)) {
      const needs = /^ {4}needs: (.+)$/m.exec(job)?.[1] ?? '';
      for (const needed of needs
        .replace(/[[\]]/g, '')
        .split(',')
        .map((each) => each.trim())
        .filter(Boolean)) {
        expect(names, `${name} needs ${needed}`).toContain(needed);
        expect(needed).not.toBe(name);
      }
    }
  });

  it('builds the exes only after the checklist and CI, and packages only after the build', () => {
    expect(jobs.build).toMatch(/needs: \[ci, checklist\]/);
    expect(jobs.package).toMatch(/needs: \[version, checklist, build, sbom\]/);
    expect(jobs.publish).toMatch(/needs: \[version, package, update-test\]/);
    expect(jobs['update-test']).toMatch(/needs: \[version, package\]/);
  });
});

describe('permissions', () => {
  it('start from nothing, and every job asks for its own', () => {
    expect(WORKFLOW).toMatch(/^permissions: \{\}$/m);
    for (const [name, job] of Object.entries(jobs))
      expect(job, name).toMatch(/^ {4}permissions:\n {6}contents: (read|write)/m);
  });

  it('let only the publish job write', () => {
    for (const [name, job] of Object.entries(jobs)) {
      expect(/: write\b/.test(job), name).toBe(name === 'publish');
    }
  });

  it('give the checklist job read access to issues and runs, and no other job', () => {
    expect(jobs.checklist).toMatch(/actions: read\n {6}issues: read/);
    for (const name of names.filter((each) => each !== 'checklist'))
      expect(jobs[name], name).not.toMatch(/issues: read/);
  });
});

describe('actions', () => {
  it('are pinned to a full commit SHA, with the version in a comment', () => {
    const used = [...WORKFLOW.matchAll(/^\s+(?:- )?uses: (\S+)(.*)$/gm)].filter((match) => !match[1].startsWith('./'));
    expect(used.length).toBeGreaterThan(8);
    for (const [, action, rest] of used) {
      expect(action, action).toMatch(/@[0-9a-f]{40}$/);
      expect(rest, action).toMatch(/# v\d/);
    }
  });

  it('are pinned in ci.yml too, which runs in the same release run and can upload artifacts to it', () => {
    expect(jobs.ci).toMatch(/^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/m);
    const used = [...CI.matchAll(/^\s+(?:- )?uses: (\S+)(.*)$/gm)];
    expect(used.length).toBeGreaterThan(20);
    for (const [, action, rest] of used) {
      expect(action, `ci.yml uses ${action}`).toMatch(/@[0-9a-f]{40}$/);
      expect(rest, `ci.yml uses ${action}`).toMatch(/# v\d/);
    }
  });

  it('check out without leaving a token on disk', () => {
    const checkouts = [...WORKFLOW.matchAll(/uses: actions\/checkout@[^\n]*\n((?: {8,}[^\n]*\n)+)/g)];
    expect(checkouts).toHaveLength(6);
    for (const [, options] of checkouts) expect(options).toContain('persist-credentials: false');
  });
});

describe('secrets', () => {
  it('appear only in the step that signs the updates, which runs only for a pushed tag', () => {
    const owners = Object.entries(jobs).flatMap(([name, job]) =>
      stepsOf(job)
        .filter((step) => /\$\{\{\s*secrets\./.test(step))
        .map((step) => `${name}: ${step.split('\n')[0]}`),
    );
    expect(owners).toEqual(['package: name: Sign the updates']);
    const step = stepNamed('package', 'Sign the updates');
    expect(step).toContain("if: github.event_name == 'push'");
    expect(step).toContain('secrets.TAURI_SIGNING_PRIVATE_KEY }}');
    expect(step).toContain('secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}');
    expect(step).not.toContain('--dry-run');
  });

  it('are not used anywhere outside a step, such as a job or workflow setting', () => {
    expect(WORKFLOW.match(/\$\{\{\s*secrets\./g)).toHaveLength(2);
  });

  it('belong to the release environment, which the package job uses for a pushed tag and never for a dry run', () => {
    expect(jobs.package).toMatch(/^ {4}environment: \$\{\{ github\.event_name == 'push' && 'release' \|\| '' \}\}$/m);
  });

  it('wait for a second approval before the publish job, and no other job uses an environment', () => {
    expect(jobs.publish).toMatch(/^ {4}environment: release$/m);
    const withEnvironment = names.filter((name) => /^ {4}environment:/m.test(jobs[name]));
    expect(withEnvironment).toEqual(['package', 'publish']);
  });
});

describe('a pushed tag', () => {
  it('is released only from a commit on main', () => {
    const step = stepNamed('version', 'Check that the tag is on main');
    expect(step).toContain("if: github.event_name == 'push'");
    expect(step).toContain('git merge-base --is-ancestor $env:GITHUB_SHA origin/main');
    expect(step).toContain('if ($LASTEXITCODE -ne 0)');
    expect(stepsOf(jobs.version)[0]).toContain('fetch-depth: 0');
  });
});

describe('the dry run', () => {
  it('is the only kind of run by hand, with its dry_run input on', () => {
    expect(WORKFLOW).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}dry_run:\n(?: {8}.+\n)+/);
    expect(WORKFLOW).toContain('        default: true\n');
    const step = stepNamed('version', 'Refuse a run by hand that is not a dry run');
    expect(step).toContain('DRY_RUN: ${{ inputs.dry_run }}');
    expect(step).toContain("if ($env:DRY_RUN -ne 'true')");
  });

  it('tests an update from the last beta with the throwaway key, and a tag with the committed key', () => {
    expect(stepNamed('update-test', 'Update from the last beta (dry run)')).toContain('--pubkey dry-run/update.pub');
    const tagged = stepNamed('update-test', 'Update from the last beta (tag)');
    expect(tagged).toContain("if: github.event_name == 'push'");
    expect(tagged).not.toContain('--pubkey');
    expect(jobs['update-test']).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it('may build without a committed update key, and a release may not', () => {
    expect(jobs.build).toContain("OPENNOTE_DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && '1' || '' }}");
  });

  it('signs with a throwaway key and never with the secrets', () => {
    const step = stepNamed('package', 'Sign with a throwaway key (dry run)');
    expect(step).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(step).toContain('--dry-run --pubkey-out dry-run/update.pub');
    expect(step).not.toContain('secrets.');
  });

  it('checks the result against the throwaway key', () => {
    expect(stepNamed('package', 'Check the dry run the way the app will')).toContain('--pubkey dry-run/update.pub');
  });

  it('never reaches the publish job', () => {
    expect(jobs.publish).toMatch(/^ {4}if: github\.event_name == 'push'$/m);
  });

  it('stays out of the publish job, which only publishes what the package job kept', () => {
    expect(stepsOf(jobs.publish).map((step) => step.split('\n')[0])).toEqual([
      'name: Download the release files',
      'name: Check that the beta channel can be updated',
      'name: Publish the release',
      'name: Update the beta channel',
    ]);
    expect(jobs.publish).not.toContain('checkout');
    // Its scripts run only the GitHub CLI, on the beta channel's prerelease.
    const allowed = /^(\$prerelease = )?gh release (view|upload) channel-manifests |^if \(|^\}$|^exit 1$|^"::error::/;
    const lines = scriptsOf(jobs.publish).flatMap((script) => script.split('\n').map((line) => line.trim()));
    for (const line of lines.filter(Boolean)) expect(line).toMatch(allowed);
  });
});

describe('the beta channel', () => {
  const config = readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'crates', 'updater', 'src', 'config.rs'),
    'utf8',
  );
  const betaUrl = /BETA_MANIFEST_URL: &str = "([^"]+)"/.exec(config)?.[1] ?? '';
  const download = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/;
  const [, owner, tag, file] = download.exec(betaUrl) ?? ['', '', '', ''];
  const forBetasOnly = "if: needs.version.outputs.enforce == 'true' && contains(needs.version.outputs.tag, '-')";

  it('is read by the updater from a fixed prerelease of this repository', () => {
    expect(owner).toBe(REPO);
    expect(tag).toBe('channel-manifests');
    expect(file).toBe('beta.json');
  });

  it("gets each beta's manifest, at the address the updater reads", () => {
    const step = stepNamed('publish', 'Update the beta channel');
    expect(step).toContain(`gh release upload ${tag} dist-release/${file} --clobber`);
    expect(step).toContain(forBetasOnly);
  });

  it('never gets a test build, whose version sorts above the betas of its release', () => {
    expect(jobs.version).toContain(
      "$enforce = ($env:GITHUB_EVENT_NAME -eq 'push') -and ($tag -notmatch '-test(\\.|$)')",
    );
    expect(stepNamed('publish', 'Update the beta channel')).toContain("needs.version.outputs.enforce == 'true'");
  });

  it('is checked before the release is published, so a missing prerelease stops it in time', () => {
    const order = stepsOf(jobs.publish).map((step) => step.split('\n')[0]);
    const check = stepNamed('publish', 'Check that the beta channel can be updated');
    expect(check).toContain(forBetasOnly);
    expect(check).toContain(`gh release view ${tag} --json isPrerelease`);
    expect(order.indexOf('name: Check that the beta channel can be updated')).toBeLessThan(
      order.indexOf('name: Publish the release'),
    );
    expect(order.indexOf('name: Update the beta channel')).toBeGreaterThan(order.indexOf('name: Publish the release'));
  });
});

describe('the package job', () => {
  const order = stepsOf(jobs.package).map((step) => /name: (.+)/.exec(step)?.[1] ?? '');
  const at = (title: string) => order.findIndex((name) => name.startsWith(title));

  it('signs, then writes the manifest, then checks the release, in that order', () => {
    const steps = [
      'Write the release notes',
      'Sign the updates',
      'Write the update manifest',
      'Write the checksums',
      'Check the release',
    ];
    const places = steps.map(at);
    expect(places.every((place) => place >= 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
  });

  it('runs no install scripts next to the signing key', () => {
    expect(stepNamed('package', 'Install tools without install scripts')).toContain('npm ci --ignore-scripts');
    expect(jobs.package).not.toMatch(/run: npm ci\s*$/m);
  });

  it('uses the release notes in the manifest', () => {
    expect(stepNamed('package', 'Write the update manifest')).toContain('RELEASE_NOTES_FILE: release-notes.txt');
  });

  it('requires an Authenticode signature for a release, and not for a test build', () => {
    const step = stepNamed('package', 'Check the release the way the app will');
    expect(step).toContain("if: github.event_name == 'push'");
    expect(step).toContain("@('--require-authenticode')");
  });

  it('writes winget manifests for a stable release only', () => {
    expect(stepNamed('package', 'Write the winget manifests')).toContain(
      "if: ${{ !contains(needs.version.outputs.tag, '-') }}",
    );
  });
});

describe('scripts', () => {
  it('never paste a context into the text of a command, where a tag name could change the command', () => {
    const risky = /\$\{\{\s*(github\.(head_ref|event\.|ref_name)|needs\.|steps\.|inputs\.)/;
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of stepsOf(job)) {
        const script = step.split(/^ {8}run: ?/m)[1]?.split(/^ {8}\S/m)[0] ?? '';
        expect(script, `${name}: ${step.split('\n')[0]}`).not.toMatch(risky);
      }
    }
  });

  it('write the version job outputs the other jobs read', () => {
    expect(jobs.version).toContain('tag: ${{ steps.tag.outputs.tag }}');
    expect(jobs.version).toContain('enforce: ${{ steps.tag.outputs.enforce }}');
    expect(jobs.version).toContain("-notmatch '-test(\\.|$)'");
  });

  it('enforce the checklist only for a pushed tag that is not a test build', () => {
    const step = stepNamed('checklist', 'Check the release checklist');
    expect(step).toContain("$extra = if ($env:ENFORCE -eq 'true') { @() } else { @('--report') }");
  });

  it('check each exe before it is signed', () => {
    expect(stepNamed('build', 'Check that the exe may ship')).toContain('check-release-exe.ts');
  });
});

describe('the files that get signed', () => {
  const order = stepsOf(jobs.package).map((step) => /name: (.+)/.exec(step)?.[1] ?? '');
  const check = 'Check the downloads before signing';

  it('are downloaded by exact name, never by a pattern that another job of the run could match', () => {
    expect(jobs.package).not.toMatch(/^ +(pattern|merge-multiple|artifact-ids):/m);
    const artifacts = stepsOf(jobs.package)
      .filter((step) => step.includes('uses: actions/download-artifact@'))
      .map((step) => /^ {10}name: (.+)$/m.exec(step)?.[1]);
    expect(artifacts).toEqual([...RELEASE_FILES.map(({ target }) => `exe-${target}`), 'sbom']);
    expect(jobs.build).toContain('name: exe-${{ matrix.target }}\n');
    expect(jobs.sbom).toContain('name: sbom\n');
  });

  it('have the hash that the build and sbom jobs reported for them', () => {
    for (const { target } of RELEASE_FILES) {
      const output = hashOutput(target);
      expect(jobs.build).toContain(`      ${output}: \${{ steps.hash.outputs.${output} }}`);
    }
    expect(stepNamed('build', 'Report the hash of the exe')).toContain('"sha256-$env:RELEASE_TARGET=$hash"');
    expect(jobs.sbom).toContain('      sha256: ${{ steps.hash.outputs.sha256 }}');
    expect(stepNamed('sbom', 'Report the hash of the bill of materials')).toContain(`dist-sbom/${SBOM_FILE}`);
    const step = stepNamed('package', check);
    expect(step).toContain('BUILD_SHA256: ${{ toJSON(needs.build.outputs) }}');
    expect(step).toContain('SBOM_SHA256: ${{ needs.sbom.outputs.sha256 }}');
    expect(step).toContain('run: node app/scripts/release/check-downloads.ts dist-release');
  });

  it('are checked after every download and before anything is signed', () => {
    const downloads = order.flatMap((name, place) => (name.startsWith('Download') ? [place] : []));
    expect(downloads).toHaveLength(4);
    expect(order.indexOf(check)).toBeGreaterThan(Math.max(...downloads));
    expect(order.indexOf(check)).toBeLessThan(order.indexOf('Sign the updates'));
    expect(order.indexOf(check)).toBeLessThan(order.indexOf('Sign with a throwaway key (dry run)'));
  });

  it('are built without a cache that the CI jobs of the same ref can write', () => {
    expect(jobs.build).not.toMatch(/^\s+cache:/m);
    expect(jobs.build).not.toContain('rust-cache');
    expect(jobs.build).not.toContain('actions/cache');
  });
});
