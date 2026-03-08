---
name: session-log
description: Update the BookSpa session log after completing a phase or making significant changes.
disable-model-invocation: true
argument-hint: "[phase-number or description]"
---

# Session Log Updater

Update `docs/session-log.md` to reflect the latest changes for: `$ARGUMENTS`

## Instructions

1. **Read the current session log:**
   Read `docs/session-log.md` to understand the current state.

2. **Identify what changed:**
   - Which phase was completed or progressed?
   - What files were created, modified, or deleted?
   - What architectural decisions were made?
   - What issues were encountered and resolved?

3. **Update the phase status:**
   - Mark completed phases with `COMPLETE` and the date
   - Update the `← NEXT PHASE` marker to the correct next phase
   - Add detailed notes under the completed phase

4. **Add file changes:**
   Under the completed phase, document:
   ```markdown
   - Files created:
     - `path/to/file.js` — description of what it does
   - Files modified:
     - `path/to/file.js` — what was changed and why
   ```

5. **Record decisions:**
   If any architectural or business logic decisions were made, add them to the `CRITICAL SCHEMA DECISIONS` section or create a new decision section.

6. **Update the "Last Updated" timestamp:**
   Change the timestamp at the top of the file to the current date and time in NPT.

## Format Rules

- Use consistent markdown formatting matching the existing style
- Phase status format: `### Phase N: Name ✓ COMPLETE` or `### Phase N: Name ← NEXT PHASE`
- Date format in status: `(YYYY-MM-DD)`
- Keep entries concise but complete
- Preserve all existing content — only add/update, never remove history

## Session Log Location

`/home/zunkireelabs/devprojects/nuad-thai-web-app/docs/session-log.md`

## Also Update Memory

After updating the session log, also update the persistent memory file to keep it in sync:

1. Read `/root/.claude/projects/-home-zunkireelabs-devprojects-nuad-thai-web-app/memory/MEMORY.md`
2. Update the "Current Phase" section to reflect the new state
3. Add any new key decisions or reference data
