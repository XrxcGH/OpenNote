# ADR 0030: Connector sign-in and token storage

- Status: Proposed, pending a sign-in with real client IDs for each service
- Date: 2026-10-03

## Context

Some features need an account at another service ([FEATURES.md](../FEATURES.md)). Microsoft Graph serves OneNote import and To Do. Google serves Calendar, Tasks, Classroom, Drive, and YouTube captions. Others are Slack sharing, Dropbox and Box sync, Vimeo captions, Readwise highlights, and a school's Canvas or Moodle. The owner asked for a Connectors page in Settings that sends the person to each service's own sign-in page and remembers the link, like the connectors page of other apps.

The decision has to meet the brand promise of being trustworthy with the person's data ([BRAND.md](../BRAND.md)):

- Everything stays off until the person connects it, and Work offline stops all of it.
- A token must never reach a file the person might share, a log, a crash report, the feedback file, or the web view.
- OpenNote is open source, so it can ship no client ID or secret of its own.
- The services differ. Some take any loopback port, some match the redirect address exactly, some have no revoke endpoint, and some take a pasted token instead.

## Decision

We will sign in as RFC 8252 (Request for Comments) asks of an app on a computer. The person's default browser opens the service's page. OpenNote asks for an authorization code with Proof Key for Code Exchange (PKCE, method S256) and a random state value. A listener on `127.0.0.1` takes one request on the exact path `/callback`, on a random port unless the service needs a fixed one. It ignores requests for other paths, ends at a return with the wrong state, and gives up after 5 minutes. The code is traded over HTTPS for tokens, and every address, redirect included, must be on the connector's pinned hosts.

We will keep access, refresh, and pasted tokens only in Windows Credential Manager, as generic credentials named `OpenNote/<connector>/<account>`, split over several credentials when a token is long. Access tokens stay in memory and are renewed from the refresh token. A file named `connections.json` holds only the account name, the access granted, and the time. The interface learns the state of each connection and never receives a token. Features reach a service through Rust, or through a command that adds the token and returns only the answer.

We will describe every service as data in one registry: endpoints, pinned hosts, the least access per feature, and how the account name is found. A connector with no client ID in `connectors.json` or the build shows "Needs setup" and links to [CONNECTORS.md](../CONNECTORS.md). A school's Canvas or Moodle takes a pasted token and an `https` address, and that address's host becomes the only host for the token.

## Options considered

| Option | For | Against |
|---|---|---|
| System browser, loopback redirect, PKCE (chosen) | The standard for apps on a computer; the person sees the real page and the address bar; no password passes through OpenNote; works with the person's saved sign-ins | Needs a free local port; some services want a fixed port registered exactly |
| Embedded web view for sign-in | Keeps the person in the app | Services warn against it, some block it, and the app could read the password |
| Device code flow | No redirect and no port | Only some services offer it, and the person types a code by hand |
| A custom URL scheme such as `opennote://` | No port | Needs registering with Windows, and another program can claim the scheme |
| One client ID shipped for everyone | Connect works at once | OpenNote would own the ID and its review, quotas, and secrets; a leaked secret affects every copy |
| Tokens in the settings file | Simple | Breaks the promise that nothing secret is in a file; the file is synced, shared, and backed up |

## Consequences

- A person can connect and disconnect any account in a few clicks, and can see in Settings, then Privacy, which servers each connector uses.
- The back end is covered by tests against a local mock server, so the sign-in, renewal, revoke, host pinning, and redaction run in CI. Nobody has signed in to a real service yet, because the repository holds no client IDs. Each service's registration steps and scopes are written from its documentation and must be checked once with a real ID.
- Services that match the redirect exactly use a fixed port (53681 to 53684). If another program holds the port, the person sees a plain message, and `redirectPort` in `connectors.json` changes it.
- Slack may require an HTTPS redirect address, which a loopback listener cannot offer. If so, that connector needs a different approach, and this record changes.
- Google keeps refresh tokens for 7 days while its consent screen is in testing, so the owner publishes the app before a release.
- Desktop apps cannot keep a client secret private. The secrets in `connectors.json` belong to the app registration, and services that allow PKCE alone are set up that way.
- Revoke runs where the service has an endpoint (Google, Dropbox, Box, Slack, Vimeo). For Microsoft and the pasted tokens, Disconnect removes the sign-in from this computer and the page says so.
- A token that reaches a log line by mistake is removed by the log's redaction, which uses the crash report scrubber's rules. Revisit this record if a service needs a token to reach the web view, or if Credential Manager's size limit changes.
