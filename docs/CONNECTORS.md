# Connectors: setting up accounts

Some OpenNote features work with an account at another service, such as OneNote import, Google Calendar meeting notes, or Canvas assignments. Settings, then Connectors, lists those accounts. This guide is for the owner of a build. It says how to register OpenNote with each service and where to put what the service gives back.

## Contents

1. [How it works](#how-it-works)
2. [Where the client IDs go](#where-the-client-ids-go)
3. [Microsoft](#microsoft)
4. [Google](#google)
5. [Slack](#slack)
6. [Dropbox](#dropbox)
7. [Box](#box)
8. [Vimeo](#vimeo)
9. [Readwise](#readwise)
10. [Canvas](#canvas)
11. [Moodle](#moodle)

## How it works

OpenNote ships with no client IDs. A card for a service that signs in on its own page says "Needs setup" until the build or the connectors file has an ID for it. Cards for Readwise, Canvas, and Moodle need no ID, because the person pastes a personal token.

When a person chooses Connect, OpenNote follows the standard for apps on a computer, [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) (Request for Comments):

- It opens the service's own sign-in page in the default browser. It never uses a window inside the app.
- It asks for an authorization code with Proof Key for Code Exchange (PKCE) and a random state value.
- The browser returns to `http://127.0.0.1:<port>/callback`. OpenNote listens for that one request, waits at most 5 minutes, and shows a page that says the tab can be closed.
- It trades the code for tokens over HTTPS, at the service's own address only.

Tokens live in Windows Credential Manager under the name `OpenNote/<connector>/<account>`. They are never written to the notes folder, the settings files, the logs, crash reports, or the feedback file. The file `connections.json` keeps only the account name, the access granted, and the time of connecting.

A service that cannot be told to forget a sign-in, such as Microsoft, gets no revoke call. Disconnect then removes the sign-in from this computer, and the person can remove OpenNote from the service's account page.

Work offline blocks every sign-in, renewal, and request. Settings, then Privacy, lists the servers each connector uses.

## Where the client IDs go

Put the IDs in a file named `connectors.json` in OpenNote's data folder. On Windows that is `%LOCALAPPDATA%\OpenNote`. In Settings, the "Open the connectors folder" button on a card opens it. A build with `OPENNOTE_PROFILE_DIR` or portable mode uses the `local` folder inside it.

```json
{
  "clients": {
    "microsoft": { "clientId": "YOUR-APPLICATION-ID" },
    "google": { "clientId": "YOUR-CLIENT-ID", "clientSecret": "YOUR-CLIENT-SECRET" },
    "dropbox": { "clientId": "YOUR-APP-KEY" },
    "box": { "clientId": "YOUR-CLIENT-ID", "clientSecret": "YOUR-CLIENT-SECRET" },
    "slack": { "clientId": "YOUR-CLIENT-ID", "clientSecret": "YOUR-CLIENT-SECRET" },
    "vimeo": { "clientId": "YOUR-CLIENT-ID", "clientSecret": "YOUR-CLIENT-SECRET" }
  }
}
```

OpenNote reads the file each time the page opens, so a change shows up without a restart.

To build the IDs into a release instead, set these variables when you run the build: `OPENNOTE_MICROSOFT_CLIENT_ID`, `OPENNOTE_GOOGLE_CLIENT_ID`, `OPENNOTE_GOOGLE_CLIENT_SECRET`, and the same pair for `SLACK`, `DROPBOX`, `BOX`, and `VIMEO`. The file wins over the build.

A client ID is not a secret, but keep the IDs out of the repository anyway. A program on a person's computer cannot keep a client secret private, so the secrets here are the app's own and not the person's. Use the services' settings for public clients where they exist.

Some services match the redirect address exactly, port included. Those connectors use a fixed port, and you register the address with it:

| Service | Redirect address to register |
|---|---|
| Slack | `http://127.0.0.1:53681/callback` |
| Dropbox | `http://127.0.0.1:53682/callback` |
| Box | `http://127.0.0.1:53683/callback` |
| Vimeo | `http://127.0.0.1:53684/callback` |

If another program uses a port, add `"redirectPort": 53999` to that service's entry and register the new address.

## Microsoft

Covers OneNote import, Outlook calendar meeting notes, and Microsoft To Do, through Microsoft Graph.

1. Open the Azure portal, then Microsoft Entra ID, then App registrations, then New registration.
2. Name it OpenNote. For supported account types, choose accounts in any organizational directory and personal Microsoft accounts.
3. Under Authentication, add a platform, choose Mobile and desktop applications, and add the custom redirect `http://127.0.0.1/callback`. Microsoft ignores the port of a loopback address.
4. On the same page, turn on "Allow public client flows".
5. Under API permissions, add these delegated Microsoft Graph permissions: `User.Read`, `Notes.Read`, `Calendars.Read`, `Tasks.ReadWrite`, `offline_access`, `openid`, `profile`, and `email`.
6. Copy the Application (client) ID into `connectors.json` as `microsoft`. Do not create a client secret.

## Google

Covers Calendar, Tasks, Classroom, Drive, and YouTube captions.

1. In the Google Cloud console, make a project. Under APIs and services, turn on the Calendar, Tasks, Classroom, Drive, and YouTube Data APIs.
2. Set up the OAuth consent screen. Add the scopes listed in the connector's "What this allows" section, and add yourself as a test user.
3. Under Credentials, create an OAuth client ID with the application type Desktop app.
4. Copy the client ID and the client secret into `connectors.json` as `google`. Google says a desktop app's secret is not confidential.
5. No redirect needs registering, because Google accepts a loopback address on any port for a desktop app.

While the consent screen is in testing, Google ends each refresh token after 7 days. Publish the app, and finish Google's verification for the sensitive scopes, before a release.

## Slack

Covers sharing a page to a channel.

1. Open api.slack.com/apps and create an app from scratch.
2. Under OAuth and permissions, add the redirect `http://127.0.0.1:53681/callback`.
3. Under User token scopes, add `chat:write`, `files:write`, and `channels:read`.
4. Copy the client ID and client secret from Basic information into `connectors.json` as `slack`.

Slack may insist on an HTTPS redirect address. If it refuses the address above, this connector cannot sign in until it allows one.

## Dropbox

Covers syncing folders and sending pages.

1. Open the Dropbox App Console and create an app with scoped access. Choose an app folder or full Dropbox.
2. On the Permissions tab, turn on `account_info.read`, `files.content.read`, and `files.content.write`, and save.
3. On the Settings tab, add the redirect `http://127.0.0.1:53682/callback`.
4. Copy the app key into `connectors.json` as `dropbox`. The app secret is optional, because OpenNote uses PKCE.

## Box

Covers syncing folders and sending pages.

1. Open the Box developer console and create a custom app with user authentication (OAuth 2.0).
2. Under Configuration, add the redirect `http://127.0.0.1:53683/callback`.
3. Under application scopes, choose the one for reading and writing all files and folders.
4. Copy the client ID and client secret into `connectors.json` as `box`.

Box takes its scopes from this configuration and not from the sign-in address.

## Vimeo

Covers using a video's captions as a transcript.

1. Open developer.vimeo.com/apps and create an app.
2. Add the callback URL `http://127.0.0.1:53684/callback`.
3. Request the `public` and `private` scopes.
4. Copy the client identifier and the client secret into `connectors.json` as `vimeo`.

## Readwise

Covers bringing book highlights into a notebook. No registration is needed.

The person opens readwise.io/access_token, copies their token, and pastes it into the Readwise card. OpenNote checks it with one request and keeps it in Windows Credential Manager.

## Canvas

Covers bringing assignments into a section. No registration is needed.

1. In Canvas, the person opens Account, then Settings, then Approved integrations, and chooses New access token.
2. They paste the token and their school's address, such as `school.instructure.com`, into the Canvas card.

Some schools turn off personal tokens. The card then says the service did not accept the token.

## Moodle

Covers bringing assignments into a section. No registration is needed.

1. The school must have web services turned on. The person opens Preferences, then Security keys, and copies the token for the Moodle mobile web service.
2. They paste the token and their school's Moodle address into the Moodle card.

The address must start with `https` and name the school's site. OpenNote talks only to that host with the token.
