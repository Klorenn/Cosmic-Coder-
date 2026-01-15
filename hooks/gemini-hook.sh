#!/bin/bash
# Vibe Coder XP Hook for Google Gemini CLI
#
# Usage: Add this to your Gemini CLI workflow or pipe output through it
# Example: gemini "your prompt" | ./gemini-hook.sh
#
# Or call it directly after Gemini operations:
#   ./gemini-hook.sh "completed task"

# Read action from argument or stdin
if [ -n "$1" ]; then
  ACTION="$1"
else
  ACTION=$(cat)
fi

# Send to Vibe Coder server
curl -s -X POST http://localhost:3333/cli/gemini \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"gemini_activity\", \"data\": {\"action\": \"$ACTION\"}}" \
  --connect-timeout 1 \
  --max-time 2 \
  > /dev/null 2>&1 &

echo "Gemini XP sent to Vibe Coder!"
exit 0
