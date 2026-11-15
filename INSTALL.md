# Machine setup

One-time steps per developer machine. Each person signs in as themselves; tokens are never shared or
copied between machines.

## Scripted Plane access (ZNLY-194, OPS-148)

Lets `/project-pm sync` regenerate `tasks/TRACKER.md` in one shell call instead of many Plane MCP turns.
macOS only. Guide: `~/Projects/zunkireelabs-org/tools/plane/README.md`.

1. Clone `Zunkireelabs/zunkireelabs-org` to `~/Projects/zunkireelabs-org` (the scripts live in `tools/plane/`).
2. Node 24 or newer: `node --version`.
3. Create the vault password in your keychain (generated, never typed, never in a file):

   ```bash
   security add-generic-password -a "$USER" -s mcporter-vault -l "mcporter OAuth vault password" -w "$(openssl rand -base64 32)"
   ```

4. Sign in to Plane as yourself (a browser opens; wait until the command returns):

   ```bash
   ~/Projects/zunkireelabs-org/tools/plane/mcp-run auth plane
   ```

5. Check it works (prints a ticket count):

   ```bash
   ~/Projects/zunkireelabs-org/tools/plane/mcp-run call plane.workitem action=count --no-oauth
   ```

You need the Plane MCP server already configured in Claude Code. If these steps are not done, `/project-pm sync`
falls back to the Plane MCP.
