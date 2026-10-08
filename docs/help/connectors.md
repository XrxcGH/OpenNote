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

The six sign-in services need a client ID. A client ID says which app is asking for access. A copy of OpenNote that was built without them shows Needs setup on those cards. If you have a client ID, choose Add a client ID on the card, paste it, and save. The card then says Not connected and offers Connect. The [connectors guide](../CONNECTORS.md) tells the maintainer where to register and where else the IDs can go. Readwise, Canvas, and Moodle need no setup.

## What connectors do

Each feature below needs its account connected first. If it is not, the command tells you and offers a way to Settings.

### Sync Readwise

Connect Readwise with your token, then press Ctrl+K and choose Sync Readwise. OpenNote makes a notebook named Readwise with a section for each kind of reading, such as Books and Articles, and a page for each book. Each highlight is one block on the page, with your note, its place in the book, and its tags.

The first sync reads everything. Later syncs read only what changed since the last one. A highlight you edit at Readwise is updated on its page, and one you delete there is removed. Blocks you write yourself on a page are never changed. If Readwise asks OpenNote to slow down, what was synced so far stays, and you can sync again in a minute.

### New meeting note

Press Ctrl+K and choose New meeting note. Pick where the meeting is: your Outlook calendar, your Google calendar, or a calendar file (.ics) from your computer. OpenNote reads the last day and the next seven, and shows them in a list. Choose one with the arrow keys and Enter.

The note goes in a section named Meetings in the notebook you have open. It holds the time, the place, who is invited, the join link, and the agenda from the invitation, with an empty Notes heading to type under. Choose the same meeting again and OpenNote opens the note you already have.

The note remembers which meeting it came from. A recording you start on that page remembers it too, so the two always name the same meeting.

### Share a page to Slack or Teams

Open a page, press Ctrl+K, and choose Share page to Slack or Share page to Teams. Pick the channel (in Teams, the team and then the channel), then pick what to post: a PDF of the page, a picture of the page or of the lasso selection, or a link.

The post is made as you, and nothing is sent until you press Post. A link opens the page in OpenNote, so it works only for people who have OpenNote and the same notebook. In Teams a picture shows in the message, and a PDF is put in the channel's Files folder with a link to it in the message.

### Courses and assignments

Connect Canvas or Moodle with your personal token, or Google for Classroom. Then press Ctrl+K and choose Bring in course assignments. Pick a course, or all of them. Each course becomes a section in the notebook you have open, with a page for each assignment. The top of the page holds the due date, a link to the assignment, and its instructions. Assignments with a due date also appear in Upcoming, and the ones you have already handed in are ticked.

Bring them in again at any time. OpenNote updates what your school changed and never touches the lines you wrote on a page.

To hand in work, open the page, press Ctrl+K, and choose Submit page as PDF. Pick the course and the assignment, and OpenNote turns the page into a PDF and hands it in. Canvas and Moodle take the file directly. Google Classroom does not accept a file from another app, so OpenNote saves the PDF in your Google Drive and copies its link. In Classroom you attach it from Drive and turn it in yourself.
