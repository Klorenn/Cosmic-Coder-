#!/bin/bash
# Vibe Coder XP Hook for Cursor AI
#
# Usage: Integrate with Cursor's extension system or run manually
# Example: ./cursor-hook.sh "code completion"

# Read action from argument or stdin
if [ -n "$1" ]; then
  ACTION="$1"
else
  ACTION=$(cat)
fi

# Send to Vibe Coder server
curl -s -X POST http://localhost:3333/cli/cursor \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"cursor_activity\", \"data\": {\"action\": \"$ACTION\"}}" \
  --connect-timeout 1 \
  --max-time 2 \
  > /dev/null 2>&1 &

echo "Cursor XP sent to Vibe Coder!"
exit 0
