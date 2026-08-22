---
name: Imported Expo mirrors
description: Environment-specific notes for Expo artifacts mounted under the conversation directory.
---

Conversation-mounted Expo artifacts can run from a nested `.conversation` path while the installed dependencies live in the main workspace artifact. In that case, Metro's workspace root must account for the extra directory depth, and the mounted artifact may need a dependency link at the conversation workspace root.

**Why:** The imported app's Metro server can start successfully while its web entry bundle still returns a resolver 404 if the nested mount is treated as the workspace root.

**How to apply:** When importing or syncing an Expo artifact from a conversation mount, verify both the active workflow path and the Metro resolution root before treating a running Metro process as a successful preview.