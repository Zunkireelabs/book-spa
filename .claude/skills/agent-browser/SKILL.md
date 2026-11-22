---
name: agent-browser
description: Browser checks on bookX (local dev or staging) with agent-browser: open pages, snapshot, click, fill, screenshot, check network, verify acceptance criteria. Use for any "open it in the browser" UI check. Trial from 2026-11-22 against Claude in Chrome (ZNLY-368); report how it compared.
allowed-tools: Bash(agent-browser:*)
---

# agent-browser (trial) for bookX

1. Before the first command, run `agent-browser skills get core` and follow it. It ships with the CLI, so it is always the current version. Install if missing: `brew install agent-browser && agent-browser install`. Health check: `agent-browser doctor`.
2. Use your own session: `agent-browser session id --scope worktree --prefix bookx`, then pass `--session <name>` on every command.
3. **Targets:** local dev (`npm start`, port 4028, e.g. `http://localhost:4028/<orgSlug>/login`) or staging (`dev-app.zennly.io`) only. Never open prod (`app.zennly.io`, `zenly.zunkireelabs.com`) with real data, and never run write actions (book, cancel, edit, discount) there.
4. **Logins:** use the test accounts in `temp_ss/local-qc-logins.txt`, saved once with `agent-browser auth save` (password via `--password-stdin`, never in a file, the repo or a command line). Do not copy or attach Sadin's Chrome profile and do not use CDP attach. If a flow needs his real logged-in session, use Claude in Chrome for that step and say so.
5. **Trial log:** at the end of each browser check, append to the ticket or a handoff: what you checked, what worked, what failed or hung, a rough tool-call count, and whether Claude in Chrome would have been easier. Put anything unchecked under "Not verified". The lead forwards logs to the Dev Environment Manager.
6. Known issues to watch for: 30 s hangs on `eval`/`close`, confirm dialogs blocking `press`, cross-origin iframes. If one hits, say so rather than retrying in a loop.
7. **Owner can watch:** the live dashboard is at http://localhost:4848 (shows every session). Give sessions a name that says what they are (e.g. `--session znly370-report`); add `--headed` for a check the owner should watch; for proof, record with `agent-browser record start temp_ss/<ticket>-<what>.webm` ... `record stop`.
