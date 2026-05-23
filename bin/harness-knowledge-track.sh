#!/bin/bash
# PostToolUse hook — track deep analysis signals
# Replaces Node.js version. Bash: <1ms vs Node: 33ms cold start.
# Matcher: Read|Write (most frequent tools, covers all signals needed)

STATE_FILE=/tmp/claude-knowledge-capture-state.json
INPUT=$(cat)

tool_name=$(echo "$INPUT" | jq -r '.tool_name // ""')
file_path=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Init state file if missing
[ -f "$STATE_FILE" ] || echo '{"planned":false,"explored":false,"readDirs":[],"captured":false}' > "$STATE_FILE"

case "$tool_name" in
  EnterPlanMode)
    jq '.planned = true' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    ;;
  Read)
    if [ -n "$file_path" ]; then
      dir=$(dirname "$file_path")
      if [ "$dir" != "." ] && [ "$dir" != "/" ]; then
        jq --arg d "$dir" '.readDirs += [$d] | .readDirs |= unique' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
      fi
    fi
    ;;
  Write)
    case "$file_path" in
      *.harness/knowledge-docs/*|*.harness/knowledge/*)
        jq '.captured = true' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
        ;;
    esac
    ;;
esac
