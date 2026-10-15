# ADR 0036: iCloud stays folder-based, with no iCloud sign-in

- Status: Accepted
- Date: 2026-10-07

## Context

OpenNote sends copies of pages to Google Drive, OneDrive, Dropbox, Box, and a WebDAV server through each service's own API, after the person signs in with that service (see [ADR 0030](0030-connectors-and-sign-in.md)). People also ask for iCloud.

Apple has no public web API for iCloud Drive that a desktop app can call, and it offers no OAuth sign-in for files outside Apple's own devices. The only supported way to read or write iCloud Drive from Windows is through Apple's iCloud for Windows app, which keeps an `iCloud Drive` folder on the PC and syncs it. A private web API exists, and it needs an Apple ID password and a two-factor code typed into the app. That would break the rule that OpenNote never sees an account password (ADR 0030), and Apple could change it without notice.

## Decision

We will not add an iCloud connector. A person who wants a copy in iCloud sends it to the `iCloud Drive` folder with "Send a copy to a folder" (Export, with favorite folders and Update the copy), and iCloud for Windows uploads it. The help says so.

## Options considered

| Option | For | Against |
|---|---|---|
| Send to a folder, which iCloud for Windows syncs (chosen) | Works today, with the account's own sign-in and encryption. No password reaches OpenNote. Nothing to break when Apple changes its servers. | The person needs iCloud for Windows installed. OpenNote can't say whether the upload finished. |
| Sign in with an Apple ID through the private web API | No extra app | OpenNote would handle an Apple ID password and a two-factor code. The API is not documented or supported, and it can stop working at any time. |
| CloudKit Web Services | Official | It reaches an app's own container, not the person's iCloud Drive. |
| Do nothing | No work | People who use iCloud have no way to keep a copy |

## Consequences

iCloud users send copies to a folder, which is also how Dropbox and OneDrive work when their desktop apps are installed. We will revisit this if Apple publishes an API for iCloud Drive with a sign-in that gives a scoped token. Whoever updates the connector registry should check Apple's developer documentation for it once a year.
