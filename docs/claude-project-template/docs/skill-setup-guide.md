# Complete MCP + Skills Setup Guide

A comprehensive reference for setting up Claude Code skills and MCP servers in any project.

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Skills](#skills)
   - [Skill Anatomy](#skill-anatomy)
   - [Skill Types](#skill-types)
   - [Creating Skills](#creating-skills)
   - [Skill Quality Checklist](#skill-quality-checklist)
4. [MCP Servers](#mcp-servers)
   - [What is MCP](#what-is-mcp)
   - [Available MCP Servers](#available-mcp-servers)
   - [Configuration](#mcp-configuration)
5. [Project Setup](#project-setup)
   - [File Structure](#file-structure)
   - [CLAUDE.md](#claudemd)
   - [Settings](#settings)
6. [Workflow](#workflow)
7. [Troubleshooting](#troubleshooting)
8. [Best Practices](#best-practices)

---

## Overview

Claude Code can be enhanced with two mechanisms:

| Mechanism | Purpose | Location |
|-----------|---------|----------|
| **Skills** | Specialized personas with domain expertise | `.claude/skills/*/SKILL.md` |
| **MCPs** | External tool integrations (DB, APIs, etc.) | `.mcp.json` |

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code Session                                        │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Skills    │    │    MCPs     │    │   Tools     │     │
│  │             │    │             │    │             │     │
│  │ project-pm  │    │  supabase   │    │   Read      │     │
│  │ skill-arch  │    │  github     │    │   Write     │     │
│  │ frontend    │    │  postgres   │    │   Bash      │     │
│  │ backend     │    │  slack      │    │   Grep      │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Automated (Recommended)

```bash
# 1. Copy template to your project
cp -r docs/claude-project-template/* /path/to/your-project/

# 2. Run setup
cd /path/to/your-project
chmod +x setup.sh
./setup.sh

# 3. Start Claude Code and analyze
# Run: /skill-architect
# Say: "Analyze this project and recommend skills"
```

### Manual

```bash
# 1. Create skill directories
mkdir -p .claude/skills/project-pm
mkdir -p .claude/skills/skill-architect

# 2. Copy skill files
cp .claude/skills/project-pm/SKILL.md /your-project/.claude/skills/project-pm/
cp .claude/skills/skill-architect/SKILL.md /your-project/.claude/skills/skill-architect/

# 3. Create CLAUDE.md
cp CLAUDE.md.template /your-project/CLAUDE.md
# Edit to match your project

# 4. Create settings
cp .claude/settings.local.json.template /your-project/.claude/settings.local.json

# 5. (Optional) Create MCP config
cp .mcp.json.template /your-project/.mcp.json
# Edit and add credentials
```

---

## Skills

### Skill Anatomy

Every skill lives in `.claude/skills/<skill-name>/SKILL.md` with two parts:

#### 1. Frontmatter (YAML)

```yaml
---
name: skill-name
description: Brief description of when/why to use this skill.
allowed-tools: Tool1, Tool2    # Optional: restrict available tools
---
```

| Field | Purpose | Required |
|-------|---------|----------|
| `name` | Skill identifier (kebab-case) | Yes |
| `description` | When/why to use (shown in listings) | Yes |
| `allowed-tools` | Restrict tool access | No |

#### 2. Body (Markdown)

```markdown
# Skill Title

## Role
What this skill does, when to invoke it.

## Scope
- What it handles
- What it does NOT handle

## Constraints
- Rules it follows
- Things it never does

## Workflow
Step-by-step execution process.

## Examples
Concrete use cases.
```

### Skill Types

| Type | Purpose | Examples |
|------|---------|----------|
| **Orchestrator** | Coordinates other skills | `project-pm` |
| **Specialist** | Deep domain expertise | `frontend-dev`, `backend-engineer` |
| **Generator** | Creates files from templates | `component-gen`, `api-gen` |
| **Utility** | Runs commands, quick reference | `deploy`, `db-migrate` |

### Creating Skills

#### Option 1: Use Skill Architect

```
1. Invoke /skill-architect
2. "Create a skill for [domain]"
3. Review and approve
```

#### Option 2: Manual Creation

```bash
# 1. Create directory
mkdir -p .claude/skills/my-skill

# 2. Create SKILL.md
cat > .claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: When and why to use this skill.
---

# My Skill

## Role
What this skill does.

## Scope
- Handles: X, Y, Z
- Does NOT handle: A, B, C

## Constraints
- Always do X
- Never do Y

## Workflow
1. Step one
2. Step two
3. Step three

## Examples

**User:** "Do the thing"
**Skill:** Does the thing following the workflow.
EOF

# 3. Update project-pm team list
# 4. Update CLAUDE.md skills table
```

### Skill Quality Checklist

#### Minimum (MUST have)

```
[ ] Frontmatter with name and description
[ ] Role definition
[ ] Scope (handles / doesn't handle)
[ ] Constraints
[ ] At least one example
```

#### Excellence (SHOULD have)

```
[ ] Tool routing (which tools for what)
[ ] Step-by-step workflow
[ ] Templates (if applicable)
[ ] Quality gates / verification steps
```

---

## MCP Servers

### What is MCP

MCP (Model Context Protocol) allows Claude Code to connect to external services like databases, APIs, and tools. When an MCP server is configured, Claude gets new capabilities (e.g., running SQL queries, managing GitHub PRs).

### Available MCP Servers

| Server | Package | Purpose |
|--------|---------|---------|
| Supabase | `@modelcontextprotocol/server-supabase` | PostgreSQL via Supabase |
| GitHub | `@modelcontextprotocol/server-github` | Repos, PRs, Issues |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Direct PostgreSQL |
| Filesystem | `@modelcontextprotocol/server-filesystem` | Extended file ops |
| Slack | `@modelcontextprotocol/server-slack` | Slack workspace |
| Memory | `@modelcontextprotocol/server-memory` | Persistent memory |

### MCP Configuration

#### File: `.mcp.json` (project root)

```json
{
  "mcpServers": {
    "supabase": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-supabase"],
      "env": {
        "SUPABASE_CONNECTION_STRING": "postgresql://..."
      }
    }
  }
}
```

#### File: `.claude/settings.local.json`

```json
{
  "permissions": {
    "allow": []
  },
  "enabledMcpjsonServers": ["supabase"],
  "enableAllProjectMcpServers": true
}
```

### Getting Credentials

#### Supabase

1. Go to Supabase Dashboard
2. Select your project
3. Settings → Database
4. Copy "Connection string (URI)" - use Transaction mode

#### GitHub

1. GitHub → Settings → Developer Settings
2. Personal Access Tokens → Tokens (classic)
3. Generate new token with repo scope

#### Slack

1. Go to api.slack.com
2. Create New App
3. OAuth & Permissions
4. Install to workspace
5. Copy Bot User OAuth Token

---

## Project Setup

### File Structure

```
your-project/
├── .mcp.json                    # MCP server configs (optional)
├── .claude/
│   ├── settings.local.json      # Claude Code settings
│   └── skills/
│       ├── project-pm/
│       │   └── SKILL.md
│       ├── skill-architect/
│       │   └── SKILL.md
│       └── [other-skills]/
│           └── SKILL.md
├── CLAUDE.md                    # Project intelligence
└── [your project files]
```

### CLAUDE.md

The `CLAUDE.md` file is the entry point for project intelligence:

```markdown
# CLAUDE.md - Project Intelligence

## Project Overview
- Name, type, tech stack

## Automatic Skill Routing
- When to auto-invoke PM
- Exceptions

## Available Skills
- Table of all skills

## Commands
- Dev, build, test, deploy

## Quality Standards
- Project-specific requirements

## Constraints
- Project-specific limitations
```

### Settings

`.claude/settings.local.json` controls:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(git *)"
    ]
  },
  "enabledMcpjsonServers": ["supabase", "github"],
  "enableAllProjectMcpServers": true
}
```

---

## Workflow

### First Session (New Project)

```
1. Run setup.sh (or manual setup)
   └── Creates .claude/, CLAUDE.md, .mcp.json

2. Start Claude Code

3. Invoke /skill-architect
   └── "Analyze this project and recommend skills"

4. Review recommendations
   └── Approve skills that make sense

5. Skill Architect creates skills
   └── Writes SKILL.md files

6. Update project-pm
   └── Add new skills to team list

7. Ready for development
   └── All tasks route through PM to specialists
```

### Ongoing Development

```
User Request
     │
     ▼
/project-pm (auto-invoked)
     │
     ├── Breaks down task
     │
     ├── Delegates to specialists
     │   ├── /frontend-dev
     │   ├── /backend-engineer
     │   └── /etc.
     │
     ├── Coordinates handoffs
     │
     └── Reports completion
```

### Adding New Skills

```
1. Identify need
   └── "We keep doing X workflow repeatedly"

2. Invoke /skill-architect
   └── "Create a skill for X"

3. Review and approve

4. Update PM and CLAUDE.md
```

---

## Troubleshooting

### Skills Not Loading

```
Problem: Skill not recognized when invoked

Check:
1. File exists: .claude/skills/<name>/SKILL.md
2. Frontmatter has name: field
3. Name matches directory name (kebab-case)
4. No syntax errors in YAML frontmatter
```

### MCP Not Connecting

```
Problem: MCP server not available

Check:
1. .mcp.json exists in project root (not in .claude/)
2. JSON is valid (no trailing commas, comments removed)
3. Server is enabled in settings.local.json
4. Credentials are correct
5. npx can access the package
```

### Skills Not Auto-Invoking

```
Problem: PM not triggered automatically

Check:
1. CLAUDE.md has skill routing rules
2. Description mentions "PROACTIVELY USE"
3. User request matches trigger patterns
```

### Permission Denied

```
Problem: Tool blocked by permissions

Fix:
Add to .claude/settings.local.json:
{
  "permissions": {
    "allow": ["Bash(command *)"]
  }
}
```

---

## Best Practices

### Skills

```
DO:
✓ Use skill-architect to create skills
✓ Keep skills focused (one domain)
✓ Include concrete examples
✓ Update PM when adding skills
✓ Define clear scope boundaries

DON'T:
✗ Create skills for one-off tasks
✗ Make monolithic mega-skills
✗ Forget to update CLAUDE.md
✗ Leave vague descriptions
```

### MCPs

```
DO:
✓ Add .mcp.json to .gitignore
✓ Use environment variables for secrets
✓ Only enable servers you need
✓ Test connection after setup

DON'T:
✗ Commit credentials to git
✗ Enable all servers blindly
✗ Forget to restart Claude Code after changes
```

### Project Setup

```
DO:
✓ Run skill-architect first session
✓ Keep CLAUDE.md updated
✓ Document commands and conventions
✓ Set quality standards upfront

DON'T:
✗ Skip the analysis phase
✗ Create too many skills too fast
✗ Forget skill dependencies
```

---

## Reference

### Skill Template

```yaml
---
name: skill-name
description: When and why to use this skill.
---

# Skill Name

## Role
What this skill does.

## Scope
- Handles: ...
- Does NOT handle: ...

## Constraints
- Always: ...
- Never: ...

## Workflow
1. ...
2. ...
3. ...

## Tool Routing
| Task | Tool |
|------|------|
| ... | ... |

## Examples

**User:** "..."
**Skill:** ...
```

### MCP Template

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "env": {
        "ENV_VAR": "value"
      }
    }
  }
}
```

### Common Skill Patterns

```
Frontend:     frontend-dev, ui-designer, animation-engineer
Backend:      backend-engineer, api-designer, auth-engineer
Database:     db-engineer, migration-manager
DevOps:       devops, deploy, ci-cd
Testing:      test-engineer, qa
Documentation: doc-writer
Meta:         project-pm, skill-architect
```
