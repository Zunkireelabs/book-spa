# Claude Code Project Template

A universal template for bootstrapping any project with Claude Code skills and MCP servers.

## What's Included

```
.claude-project-template/
├── README.md                 # This file
├── setup.sh                  # One-command setup script
├── .mcp.json.template        # MCP server configurations
├── .claude/
│   ├── settings.local.json.template
│   └── skills/
│       ├── project-pm/       # Generic orchestrator (adapts to any project)
│       │   └── SKILL.md
│       └── skill-architect/  # Analyzes codebase, creates skills
│           └── SKILL.md
├── CLAUDE.md.template        # Project instructions skeleton
└── docs/
    └── skill-setup-guide.md  # Complete reference guide
```

## Quick Start

### Option 1: Automated Setup

```bash
# Copy template to your project
cp -r docs/claude-project-template/* /path/to/your-project/

# Run setup script
cd /path/to/your-project
chmod +x setup.sh
./setup.sh
```

### Option 2: Manual Setup

1. Copy the `.claude/` folder to your project root
2. Copy `CLAUDE.md.template` to your project root as `CLAUDE.md`
3. Copy `.mcp.json.template` to your project root as `.mcp.json`
4. Edit each file to match your project

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Run setup.sh                                                │
│     └── Creates .claude/, CLAUDE.md, .mcp.json                  │
│                                                                 │
│  2. Invoke /skill-architect                                     │
│     └── "Analyze this project and recommend skills"             │
│     └── Outputs: tech stack, recommended skills, priorities     │
│                                                                 │
│  3. Approve skill recommendations                               │
│     └── Skill Architect creates the skills                      │
│                                                                 │
│  4. PM is ready                                                 │
│     └── Routes all development tasks to specialists             │
│                                                                 │
│  5. Configure MCPs (optional)                                   │
│     └── Fill credentials in .mcp.json for DB/API access         │
└─────────────────────────────────────────────────────────────────┘
```

## Core Skills

### `/project-pm` - The Orchestrator

- Analyzes your project structure and tech stack
- Breaks down tasks into subtasks
- Delegates to specialist skills
- Ensures quality standards
- Reports progress

**Auto-invocation:** Configure in CLAUDE.md to route all development tasks through PM.

### `/skill-architect` - The Skill Creator

- Scans any codebase to understand patterns
- Recommends skills based on tech stack and workflows
- Creates well-structured skills following best practices
- Integrates new skills with the PM

**When to use:** First session on a new project, or when you need new capabilities.

## MCP Servers

The template includes configurations for common MCP servers:

| MCP Server | Purpose | When to Add |
|------------|---------|-------------|
| Supabase | PostgreSQL database access | Projects with Supabase |
| GitHub | Repo, PR, issue management | All projects |
| Filesystem | Extended file operations | Large codebases |

MCPs are **optional** - only configure what your project needs.

## Customization

### Project-Specific PM

After setup, edit `.claude/skills/project-pm/SKILL.md` to add:
- Your project's quality standards
- Tech stack specifics
- Team/skill list (after skill-architect creates them)

### CLAUDE.md

Edit `CLAUDE.md` to add:
- Project overview
- Commands (dev, build, test, deploy)
- Conventions
- Skill routing rules

## Best Practices

1. **Run skill-architect first** - Let it analyze before creating skills manually
2. **Keep PM updated** - Add new skills to PM's team list
3. **Don't over-skill** - Only create skills for repeated workflows
4. **Secure credentials** - Add `.mcp.json` to `.gitignore`

## Reference

See `docs/skill-setup-guide.md` for complete documentation on:
- Skill anatomy and types
- MCP configuration details
- Troubleshooting
- Advanced patterns
