#!/usr/bin/env bash
# BooX Pre-Deployment Validation Script
# Run: bash .claude/skills/deploy-check/scripts/validate.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
ERRORS=0
WARNINGS=0

echo "========================================"
echo "  BooX Pre-Deployment Validator"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo ""

# Check 1: Environment variables
echo "--- Environment Variables ---"
if [ -f "$PROJECT_DIR/.env" ]; then
  if grep -q "VITE_SUPABASE_URL" "$PROJECT_DIR/.env"; then
    echo -e "${GREEN}[PASS]${NC} VITE_SUPABASE_URL is set"
  else
    echo -e "${RED}[FAIL]${NC} VITE_SUPABASE_URL is missing"
    ERRORS=$((ERRORS + 1))
  fi
  if grep -q "VITE_SUPABASE_ANON_KEY" "$PROJECT_DIR/.env"; then
    echo -e "${GREEN}[PASS]${NC} VITE_SUPABASE_ANON_KEY is set"
  else
    echo -e "${RED}[FAIL]${NC} VITE_SUPABASE_ANON_KEY is missing"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}[FAIL]${NC} .env file not found"
  ERRORS=$((ERRORS + 1))
fi

# Check .env in .gitignore
if grep -q "\.env" "$PROJECT_DIR/.gitignore" 2>/dev/null; then
  echo -e "${GREEN}[PASS]${NC} .env is in .gitignore"
else
  echo -e "${RED}[CRITICAL]${NC} .env is NOT in .gitignore"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 2: Console.log statements
echo "--- Code Quality ---"
CONSOLE_COUNT=$(grep -r "console\.log" "$PROJECT_DIR/src" --include="*.jsx" --include="*.js" -l 2>/dev/null | wc -l)
if [ "$CONSOLE_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}[WARN]${NC} Found console.log in $CONSOLE_COUNT files"
  WARNINGS=$((WARNINGS + 1))
else
  echo -e "${GREEN}[PASS]${NC} No console.log statements"
fi

DEBUGGER_COUNT=$(grep -r "debugger" "$PROJECT_DIR/src" --include="*.jsx" --include="*.js" -l 2>/dev/null | wc -l)
if [ "$DEBUGGER_COUNT" -gt 0 ]; then
  echo -e "${RED}[FAIL]${NC} Found debugger statements in $DEBUGGER_COUNT files"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}[PASS]${NC} No debugger statements"
fi

MOCK_COUNT=$(grep -r "mockBookings\|mockTherapists\|mockData" "$PROJECT_DIR/src" --include="*.jsx" --include="*.js" -l 2>/dev/null | wc -l)
if [ "$MOCK_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}[WARN]${NC} Found mock data references in $MOCK_COUNT files"
  WARNINGS=$((WARNINGS + 1))
else
  echo -e "${GREEN}[PASS]${NC} No mock data references"
fi
echo ""

# Check 3: Build
echo "--- Build Validation ---"
cd "$PROJECT_DIR"
if npm run build > /dev/null 2>&1; then
  echo -e "${GREEN}[PASS]${NC} Build succeeded"
  if [ -f "$PROJECT_DIR/dist/index.html" ]; then
    echo -e "${GREEN}[PASS]${NC} dist/index.html exists"
  else
    echo -e "${RED}[FAIL]${NC} dist/index.html not found"
    ERRORS=$((ERRORS + 1))
  fi
  DIST_SIZE=$(du -sm "$PROJECT_DIR/dist" 2>/dev/null | cut -f1)
  if [ "$DIST_SIZE" -lt 5 ]; then
    echo -e "${GREEN}[PASS]${NC} Bundle size: ${DIST_SIZE}MB (under 5MB limit)"
  else
    echo -e "${YELLOW}[WARN]${NC} Bundle size: ${DIST_SIZE}MB (consider optimization)"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${RED}[FAIL]${NC} Build failed"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 4: Git status
echo "--- Git Status ---"
cd "$PROJECT_DIR"
if git diff --quiet 2>/dev/null; then
  echo -e "${GREEN}[PASS]${NC} No uncommitted changes"
else
  echo -e "${YELLOW}[WARN]${NC} Uncommitted changes detected"
  WARNINGS=$((WARNINGS + 1))
fi

BRANCH=$(git branch --show-current 2>/dev/null)
echo -e "       Current branch: $BRANCH"
echo ""

# Summary
echo "========================================"
if [ "$ERRORS" -gt 0 ]; then
  echo -e "  Result: ${RED}FIX REQUIRED${NC} ($ERRORS errors, $WARNINGS warnings)"
else
  echo -e "  Result: ${GREEN}READY TO DEPLOY${NC} ($WARNINGS warnings)"
fi
echo "========================================"

exit $ERRORS
