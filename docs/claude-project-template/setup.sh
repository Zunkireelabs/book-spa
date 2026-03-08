#!/bin/bash

# Claude Code Project Setup Script
# Bootstraps a project with PM + Skill Architect + MCP configuration

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Claude Code Project Setup                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get project directory (where this script is run from)
PROJECT_DIR=$(pwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if we're in the template directory
if [[ "$PROJECT_DIR" == *"claude-project-template"* ]]; then
    echo -e "${RED}Error: Don't run this script from inside the template folder.${NC}"
    echo -e "Copy the template to your project first, then run setup.sh from there."
    exit 1
fi

# Step 1: Get project name
echo -e "${YELLOW}Step 1: Project Configuration${NC}"
echo ""

# Try to detect project name from package.json or directory name
if [ -f "package.json" ]; then
    DETECTED_NAME=$(grep -o '"name": *"[^"]*"' package.json | head -1 | cut -d'"' -f4)
else
    DETECTED_NAME=$(basename "$PROJECT_DIR")
fi

read -p "Project name [$DETECTED_NAME]: " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-$DETECTED_NAME}

# Step 2: Detect tech stack
echo ""
echo -e "${YELLOW}Step 2: Detecting Tech Stack${NC}"
echo ""

TECH_STACK=""

# Detect based on files
if [ -f "package.json" ]; then
    if grep -q "next" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK Next.js,"
    fi
    if grep -q "react" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK React,"
    fi
    if grep -q "vue" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK Vue,"
    fi
    if grep -q "typescript" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK TypeScript,"
    fi
    if grep -q "tailwind" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK Tailwind,"
    fi
    if grep -q "three" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK Three.js,"
    fi
    if grep -q "gsap" package.json 2>/dev/null; then
        TECH_STACK="$TECH_STACK GSAP,"
    fi
fi

if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
    TECH_STACK="$TECH_STACK Python,"
    if grep -q "django" requirements.txt 2>/dev/null || grep -q "django" pyproject.toml 2>/dev/null; then
        TECH_STACK="$TECH_STACK Django,"
    fi
    if grep -q "fastapi" requirements.txt 2>/dev/null || grep -q "fastapi" pyproject.toml 2>/dev/null; then
        TECH_STACK="$TECH_STACK FastAPI,"
    fi
    if grep -q "flask" requirements.txt 2>/dev/null || grep -q "flask" pyproject.toml 2>/dev/null; then
        TECH_STACK="$TECH_STACK Flask,"
    fi
fi

if [ -f "go.mod" ]; then
    TECH_STACK="$TECH_STACK Go,"
fi

if [ -f "Cargo.toml" ]; then
    TECH_STACK="$TECH_STACK Rust,"
fi

if [ -f "docker-compose.yml" ] || [ -f "Dockerfile" ]; then
    TECH_STACK="$TECH_STACK Docker,"
fi

# Remove trailing comma
TECH_STACK=${TECH_STACK%,}

if [ -n "$TECH_STACK" ]; then
    echo -e "Detected:${GREEN}$TECH_STACK${NC}"
else
    echo "No tech stack detected. Skill Architect will analyze manually."
fi

# Step 3: MCP Configuration
echo ""
echo -e "${YELLOW}Step 3: MCP Server Configuration${NC}"
echo ""

SETUP_SUPABASE="n"
SETUP_GITHUB="n"

read -p "Set up Supabase MCP? (y/N): " SETUP_SUPABASE
read -p "Set up GitHub MCP? (y/N): " SETUP_GITHUB

# Step 4: Create directory structure
echo ""
echo -e "${YELLOW}Step 4: Creating Project Structure${NC}"
echo ""

# Create .claude directory
mkdir -p .claude/skills/project-pm
mkdir -p .claude/skills/skill-architect

echo -e "${GREEN}✓${NC} Created .claude/skills/"

# Step 5: Copy skill files
# Check if we're running from template or if files are alongside script
if [ -f "$SCRIPT_DIR/.claude/skills/project-pm/SKILL.md" ]; then
    cp "$SCRIPT_DIR/.claude/skills/project-pm/SKILL.md" .claude/skills/project-pm/
    cp "$SCRIPT_DIR/.claude/skills/skill-architect/SKILL.md" .claude/skills/skill-architect/
    echo -e "${GREEN}✓${NC} Copied core skills (project-pm, skill-architect)"
else
    echo -e "${YELLOW}!${NC} Skill templates not found. Creating from embedded templates..."

    # Create project-pm skill inline (abbreviated for setup script)
    cat > .claude/skills/project-pm/SKILL.md << 'PMEOF'
---
name: project-pm
description: Product Manager and Team Lead. PROACTIVELY USE for ALL development tasks. Orchestrates specialists, breaks down work, ensures quality. Route all development through this skill.
---

# Project PM - Orchestrator

You are the **Team Lead and Orchestrator** for this project.

## YOUR ROLE

1. Takes user requests and breaks them into executable tasks
2. Delegates to specialized skills in the correct order
3. Ensures quality standards are met
4. Coordinates handoffs between skills
5. Reports progress and blockers

## FIRST SESSION ACTIONS

If this is a new project without specialized skills:
1. Invoke `/skill-architect` to analyze the codebase
2. Review recommended skills
3. Create approved skills
4. Update this file with your team list

## YOUR TEAM

<!-- skill-architect will populate this -->
| Skill | Domain | When to Delegate |
|-------|--------|------------------|
| `/skill-architect` | Skills | Create new skills, analyze gaps |

## WORKFLOW

1. **Understand** - Read request, check docs
2. **Break down** - Decompose into tasks
3. **Delegate** - Invoke specialist skills
4. **Verify** - Quality gates before complete
5. **Report** - Progress updates

## QUALITY GATES

Before marking any task complete:
- Code compiles without errors
- Tests pass (if applicable)
- No TypeScript `any` types
- Follows project conventions

**You are the leader. Lead.**
PMEOF
    echo -e "${GREEN}✓${NC} Created project-pm skill"

    # Create skill-architect skill inline (abbreviated)
    cat > .claude/skills/skill-architect/SKILL.md << 'SAEOF'
---
name: skill-architect
description: Expert in creating and optimizing Claude Code skills. Use when analyzing a new project, creating skills, improving existing skills, or auditing skill coverage.
---

# Skill Architect

You are the **Skill Creation and Optimization Expert**.

## YOUR ROLE

1. **Analyze projects** - Understand tech stack, patterns, workflows
2. **Identify skill gaps** - What's needed for this project
3. **Create skills** - Well-structured, following best practices
4. **Optimize skills** - Improve clarity and effectiveness
5. **Integrate skills** - Update PM with new team members

## ANALYSIS WORKFLOW

When asked to analyze a project:

```
1. Read CLAUDE.md (if exists)
2. Scan project structure (package.json, src/, etc.)
3. Identify tech stack
4. Identify repeated workflows
5. Recommend skills with reasoning
```

## OUTPUT FORMAT

```markdown
## Project Analysis: [Name]

### Tech Stack
- [Framework/Language]
- [Libraries]
- [Tools]

### Recommended Skills

| Skill | Type | Purpose | Priority |
|-------|------|---------|----------|
| name | Specialist/Generator/Utility | What it does | High/Medium/Low |

### Reasoning
[Why each skill is needed]

### Next Steps
1. Approve skills
2. I'll create them
3. Update project-pm team list
```

## SKILL ANATOMY

Every skill has:

```yaml
---
name: skill-name
description: When/why to use this skill
---

# Skill Title

## Role
## Scope
## Constraints
## Workflow
## Examples
```

## SKILL TYPES

1. **Orchestrator** - Coordinates other skills (PM)
2. **Specialist** - Deep domain expertise
3. **Generator** - Creates files from patterns
4. **Utility** - Runs commands, quick reference

## QUALITY CHECKLIST

Every skill MUST have:
- [ ] name (kebab-case)
- [ ] description (when to use)
- [ ] Role definition
- [ ] Scope (what it handles / doesn't handle)
- [ ] At least one example

**You are the skill expert. Build great skills.**
SAEOF
    echo -e "${GREEN}✓${NC} Created skill-architect skill"
fi

# Step 6: Create CLAUDE.md
echo ""
echo -e "${YELLOW}Step 5: Creating CLAUDE.md${NC}"
echo ""

cat > CLAUDE.md << EOF
# CLAUDE.md - Project Intelligence

## Project Overview

**Project**: $PROJECT_NAME
**Tech Stack**: $TECH_STACK

---

## Automatic Skill Routing

When the user gives ANY development request, **automatically invoke \`/project-pm\`**.

### Trigger Patterns (auto-invoke PM):
- "Build/Create/Implement/Add X"
- "Fix/Update/Change/Refactor X"
- Feature requests or bug fixes

### Exceptions (do NOT auto-invoke):
- Questions: "How does X work?"
- Reading: "Show me X"
- Direct skill invocation (\`/skill-name\`)

---

## Available Skills

| Skill | Domain | When to Use |
|-------|--------|-------------|
| \`/project-pm\` | **Orchestrator** | All development tasks |
| \`/skill-architect\` | **Meta** | Create/optimize skills |

<!-- Add more skills as they're created -->

---

## Commands

\`\`\`bash
# Development
npm run dev

# Build
npm run build

# Test
npm test

# Deploy
./deploy.sh
\`\`\`

---

## Project Structure

\`\`\`
$PROJECT_NAME/
├── src/
├── ...
└── CLAUDE.md
\`\`\`

---

## Quality Standards

\`\`\`
1. Code compiles without errors
2. Tests pass
3. TypeScript strict (no \`any\`)
4. Follows project conventions
\`\`\`
EOF

echo -e "${GREEN}✓${NC} Created CLAUDE.md"

# Step 7: Create settings.local.json
cat > .claude/settings.local.json << EOF
{
  "permissions": {
    "allow": []
  },
  "enableAllProjectMcpServers": true
}
EOF

echo -e "${GREEN}✓${NC} Created .claude/settings.local.json"

# Step 8: Create .mcp.json if MCPs requested
if [[ "$SETUP_SUPABASE" =~ ^[Yy]$ ]] || [[ "$SETUP_GITHUB" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Step 6: Creating MCP Configuration${NC}"
    echo ""

    MCP_CONTENT='{\n  "mcpServers": {'
    FIRST=true

    if [[ "$SETUP_SUPABASE" =~ ^[Yy]$ ]]; then
        if [ "$FIRST" = false ]; then MCP_CONTENT="$MCP_CONTENT,"; fi
        FIRST=false
        MCP_CONTENT="$MCP_CONTENT"'
    "supabase": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-supabase"],
      "env": {
        "SUPABASE_CONNECTION_STRING": "YOUR_CONNECTION_STRING_HERE"
      }
    }'
        echo -e "${YELLOW}!${NC} Remember to add your Supabase connection string to .mcp.json"
    fi

    if [[ "$SETUP_GITHUB" =~ ^[Yy]$ ]]; then
        if [ "$FIRST" = false ]; then MCP_CONTENT="$MCP_CONTENT,"; fi
        FIRST=false
        MCP_CONTENT="$MCP_CONTENT"'
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "YOUR_GITHUB_TOKEN_HERE"
      }
    }'
        echo -e "${YELLOW}!${NC} Remember to add your GitHub token to .mcp.json"
    fi

    MCP_CONTENT="$MCP_CONTENT"'
  }
}'

    echo -e "$MCP_CONTENT" > .mcp.json
    echo -e "${GREEN}✓${NC} Created .mcp.json"

    # Add to gitignore
    if [ -f ".gitignore" ]; then
        if ! grep -q ".mcp.json" .gitignore; then
            echo ".mcp.json" >> .gitignore
            echo -e "${GREEN}✓${NC} Added .mcp.json to .gitignore"
        fi
    fi
fi

# Done
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Setup Complete!                                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Created:"
echo "  - .claude/skills/project-pm/SKILL.md"
echo "  - .claude/skills/skill-architect/SKILL.md"
echo "  - .claude/settings.local.json"
echo "  - CLAUDE.md"
if [[ "$SETUP_SUPABASE" =~ ^[Yy]$ ]] || [[ "$SETUP_GITHUB" =~ ^[Yy]$ ]]; then
    echo "  - .mcp.json"
fi
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Start Claude Code in this project"
echo "  2. Run: /skill-architect"
echo "  3. Say: \"Analyze this project and recommend skills\""
echo "  4. Approve the recommended skills"
echo ""
