# Pinned Messages

Pin user and assistant messages in a BB thread and read them without scrolling the chat.

## Installation

Install directly from GitHub in BB:

```sh
bb plugin install git:https://github.com/kuntashov/bb-plugin-pinned-messages.git@main
```

Requires BB 0.48 or later and Plugin SDK 0.6.104 or later. The repository tracks ongoing development; no public release has been published yet.

## Usage

Use the pin action on a message; pressing it again unpins the message. The first pin's first two lines and a count appear above the composer; links in the preview are clickable. Open the preview or **Pins** in the thread header to see the list and the full message in a side panel. **Unpin** removes a pin. Select text in the full message and choose **Add to chat** to insert a quote and a message reference into the draft. Pins are ordered by when they were added and loaded in pages of 50.

Pins are snapshots: subsequent edits or streamed text do not change them. Unpin and pin again to refresh a snapshot. Attachments are not copied. Deleting a thread deletes its pins. SQLite stores pins on the server; realtime updates connected clients. Reading pins does not load the thread history.

The message action also appears in the chat's text-selection menu and applies to the entire message. The action does not currently indicate whether a message is pinned. Embedded `ThreadChat` views do not expose the message action.

## CLI

```sh
bb pinned-messages pin <thread-id> <message-seq>
bb pinned-messages unpin <thread-id> <message-seq>
```

Both commands are idempotent. The sequence is the message sequence used by `bb thread log --message`, not `sourceSeqEnd`. For a project-specific rule, inspect the first conversation message using `bb thread log <thread-id> --format json`, then retrieve it with `bb thread log <thread-id> --message <seq> --json`. Confirm `message.role` is `user` and `message.text` starts with the project's ticket identifier before calling the command with `message.messageSeq`. Define the ticket format in that project's instructions. This plugin does not automatically pin messages.

## Development

```sh
npm ci --include=dev
npm run check
npm test
bb plugin build
bb plugin install . --yes
```

The installation path must be on the BB server machine. On a Windows host daemon, `NODE_PATH` may need to point to the installed npm directory for the build toolchain. The plugin uses experimental SDK APIs.
