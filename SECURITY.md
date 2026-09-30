# Security policy

OpenNote keeps people's notes, recordings, and drawings on their own computers, and it updates itself from GitHub Releases. Security problems in either area matter to us. This page explains how to report one privately and what happens next.

## Supported versions

OpenNote is an early prototype. Only the latest release receives security fixes. Fixes ship in a new release, not as patches to older ones, so please check that the problem still exists in the latest release before you report it.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases, nightly builds, and unreleased branches | No |

## Report a vulnerability

Please don't open a public issue, pull request, or discussion about a vulnerability. Report it privately through GitHub private vulnerability reporting instead:

1. Open the [new security advisory form](https://github.com/XrxcGH/OpenNote/security/advisories/new). You can also reach it from the repository's **Security** tab by choosing **Report a vulnerability**.
2. Fill in the form, and submit it. Only you and the maintainers can see the report and the discussion that follows.

If the form isn't available, open a public issue that asks for a private contact. Leave out every detail of the problem.

## What to include

- The OpenNote version, and your Windows version and edition.
- The part of OpenNote that is affected, such as the updater, note storage, import, or audio recording.
- Clear steps to reproduce the problem, and a proof of concept if you have one. Please remove any personal data from sample files.
- What an attacker could do, and what they need first, such as local access or a crafted note file.
- Whether anyone else knows about the problem, and whether it is already public.
- How you would like to be credited, or whether you'd prefer to stay anonymous.

## What to expect

- We confirm that we received your report within seven days.
- Within 14 days, we tell you whether we accept it as a vulnerability and how serious we think it is.
- While we work on a fix, we update you at least every 14 days.
- The fix ships in a new release. We then publish a GitHub security advisory that credits you, unless you asked us not to. GitHub may assign it a Common Vulnerabilities and Exposures (CVE) ID.
- If we decide the report isn't a vulnerability, we explain why. You can then open a public issue if it is still a bug.

OpenNote is maintained by volunteers, so these times are goals rather than promises. Please keep the details private until the fix is released, or for 90 days after your report, whichever comes first. If you need a different timeline, say so in the report, and we will agree on one together.

## Scope

In scope are the code in this repository, the release workflow, and the update process. That includes the update manifest and its signatures, described in [Signing and security](DEVELOPMENT.md#signing-and-security).

Out of scope are problems in Windows, Microsoft Edge WebView2, or a third-party library that aren't caused by how OpenNote uses them. Please report those to the vendor or project. Let us know too if OpenNote needs an urgent update because of one.

We won't take legal action against research done in good faith that follows this policy. Test only against your own devices and data, and don't access, change, or delete other people's notes.
