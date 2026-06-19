# Copilot-Chat parity: research and feature proposals

A study of GitHub Copilot Chat's UX and how this extension compares, with prioritized proposals. Copilot behaviour is summarized from public docs and feature descriptions.

## How Copilot Chat is structured

- **Locations**: chat view, Quick Chat, Inline Chat in the editor, and chat in an editor tab.
- **Context references (`#`)**: file, folder, selection, editor, changes, problems, terminal selection, fetch, symbols, and codebase-style references.
- **Participants (`@`)**: examples include workspace, VS Code, and terminal routing.
- **Slash commands (`/`)**: `/explain`, `/fix`, `/tests`, `/doc`, `/new`, `/clear`, etc.
- **Modes**: Ask, Edit, and Agent.
- **Code block actions**: copy, insert at cursor, insert into new file, run/apply actions.
- **Conversation UX**: streamed answers, references, follow-up suggestions, edit/regenerate, model picker, and history.

## What this extension already has

| Capability | Status |
| --- | --- |
| Multi-provider + model picker (live model list) | done |
| Agent mode with tool loop, permissions, reasoning | done |
| Three-tier search (keyword / symbol / semantic) | done |
| Token + cache analytics | done |
| Multiple agents, sub-agents, skills, MCP | done |
| Chat history, drag-and-drop attachments | done |
| Full-screen "open in editor" mode | done |
| `#` file/folder reference picker | done |
| Copy buttons (reply + per code block) | done |
| Full markdown rendering (GFM) | done |
| Model badge on each answer | done |
| Slash commands (`/explain /fix /tests /doc /clear`) | done |
| Context chips (selection / file / problems / git changes) | done |
| Code block actions (copy / insert at cursor / insert into new file) | done |
| Diff preview + Accept/Reject for file edits | done |
| Regenerate/Edit controls | done |
| Quick Chat / Inline Chat commands + keybindings | done |
| Export conversation to Markdown | done |
| Analyze chats -> quality review + improve agents/skills | done |
| `@workspace`, `@terminal`, `@vscode` routing shortcuts | baseline done |
| Working set for edit mode (tracked modified files) | done |
| Image attachments for vision-capable models | done |
| Per-message token cost display | done |
| Streaming references panel (tools + files used) | done |
| Voice input (speech-to-text) | done |

### Placement on the right

VS Code does not let an extension force the Secondary Side Bar via the manifest. The view lives in the Activity Bar by default; drag it into the Secondary Side Bar and VS Code remembers it. The Open in editor button gives the full-screen experience immediately.

## Proposed features (prioritized)

### P1 - high value, low/medium effort

1. Slash commands: done (`/explain /fix /tests /doc /clear`).
2. More `#` context types: done (selection / file / problems / changes as chips).
3. Code block actions: done (copy / insert at cursor / insert into new file).
4. Follow-up suggestions: done (lightweight next-step chips after replies).
5. Stop/Regenerate/Edit controls: done.

### P2 - high value, higher effort

6. Inline diff / apply edits: done. `write_file` and `edit_file` open a VS Code diff preview and require Accept/Reject before writing.
7. Inline Chat: done. `AI Agent: Inline Chat` (`Ctrl+I` / `Cmd+I`) sends the active selection/file as context.
8. Quick Chat: done. `AI Agent: Quick Chat` opens a transient input for one-off questions.
9. Working set for edit mode: done. Modified files are tracked and displayed in a collapsible panel.
10. Image attachments for vision-capable models: done. Images are converted to base64 data URLs and sent to vision-capable providers.

### P3 - polish

11. `@` participants: baseline done for `@workspace`, `@terminal`, and `@vscode` routing shortcuts.
12. Streaming references panel: done. Collapsible panel showing tools used and files accessed during the response.
13. Voice input: done. Speech-to-text via Web Speech API. Export conversation to Markdown: done. Per-message token cost: done. Estimated cost displayed with per-provider rates.
14. Keybindings: done for inline chat, quick chat, and new chat.

## Suggested next steps

The highest-value remaining gaps are:

1. **Inline Chat model picker** — let users switch models mid-conversation without opening settings.
2. **Chat participant routing (`@workspace`, `@terminal`, `@vscode`)** — currently baseline shortcuts; need full context injection like Copilot.
3. **Terminal command execution integration** — deep integration with VS Code terminal for running commands with output capture.
4. **Multi-root workspace support** — handle workspaces with multiple folders.
5. **Trust & release readiness** — permission UX refinement, audit log for tool calls, E2E smoke tests, security hardening for Telegram.

> Content was rephrased for compliance with licensing restrictions.
