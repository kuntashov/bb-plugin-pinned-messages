---
name: pinned-messages
description: Pin messages and read saved messages in BB with the Pinned Messages plugin.
---

Use the pin action on a user or assistant message. Open **Pins** in the thread header or the preview above the composer to read saved messages in the side panel without scrolling the chat. Unpin from the panel. Pins are snapshots; unpin and pin again to refresh the text. Attachments are not copied.

To pin or unpin a known message, run `bb pinned-messages pin <thread-id> <message-seq>` or `bb pinned-messages unpin <thread-id> <message-seq>`. Both commands are idempotent. Use the message sequence accepted by `bb thread log --message`, not `sourceSeqEnd`. For a project-specific first-message rule, inspect the first conversation message and verify its user role and the project-defined ticket prefix before invoking the command. Do not apply the rule globally.
