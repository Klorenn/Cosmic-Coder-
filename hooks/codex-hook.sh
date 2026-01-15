#!/bin/bash
# Vibe Coder XP Hook for OpenAI Codex CLI
#
# Usage: Add this to your Codex CLI workflow or pipe output through it
# Example: codex "your prompt" | ./codex-hook.sh
#
# Or call it directly after Codex operations:
#   ./codex-hook.sh "completed task"

# Read action from argument or stdin
if [ -n "$1" ]; then
  ACTION="$1"
else
  ACTION=$(cat)
fi

# Send to Vibe Coder server
curl -s -X POST http://localhost:3333/cli/codex \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"codex_activity\", \"data\": {\"action\": \"$ACTION\"}}" \
  --connect-timeout 1 \
  --max-time 2 \
  > /dev/null 2>&1 &

echo "Codex XP sent to Vibe Coder!"
exit 0
