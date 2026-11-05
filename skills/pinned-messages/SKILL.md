---
name: pinned-messages
description: Pin messages and read saved messages in BB with the Pinned Messages plugin.
---

Use the pin action on a user or assistant message. To pin an excerpt, select text in the chat and choose **Pin message**. Each selection creates a separate pin. Open **Pins** in the thread header or the preview above the composer to read saved messages and excerpts in the side panel without scrolling the chat. Unpin individual entries from the panel. Pins are snapshots; unpin and pin again to refresh the text. Attachments are not copied.

To pin or unpin a known whole message, run `bb pinned-messages pin <thread-id> <message-seq>` or `bb pinned-messages unpin <thread-id> <message-seq>`. Both commands are idempotent and do not affect excerpt pins. Use the message sequence accepted by `bb thread log --message`, not `sourceSeqEnd`. For a project-specific first-message rule, inspect the first conversation message and verify its user role and the project-defined ticket prefix before invoking the command. Do not apply the rule globally.
