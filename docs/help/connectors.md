# Connectors

A connector signs OpenNote in to another service so a feature can use it. Everything is off until you connect it, and you can disconnect at any time.

![The Connectors page in Settings, with a card for each service saying Needs setup](../screens/settings-connectors-light.png)

## Connect a service

Open Settings, then Connectors. Each service has a card.

| Services | How you connect |
|---|---|
| Microsoft, Google, Slack, Dropbox, Box, and Vimeo | Choose Connect. The service's own sign-in page opens in your browser, never inside OpenNote. |
| Readwise, Canvas, and Moodle | Choose Connect and paste a personal token from your account. |

When a card says Connected, it shows the account name. Choose Disconnect to remove the connection. OpenNote then forgets the token.

## Where your tokens live

OpenNote keeps each token in Windows Credential Manager. It never writes one to a file, the log, or the feedback file. Work offline blocks connecting.

## Why a card says Needs setup

The six sign-in services need a client ID. A client ID says which app is asking for access. Beta 4 ships without any, so those cards say Needs setup. The [connectors guide](../CONNECTORS.md) tells the maintainer where to register and where the IDs go. Readwise, Canvas, and Moodle need no setup.

## What connectors do today

In beta 4, connecting is the first step only. No feature uses a connector yet. Syncing tasks, sending to Drive or OneDrive, and importing from a course site are next. The [feature list](../FEATURES.md) shows each one as needing the owner's accounts.
