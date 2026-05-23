#!/bin/bash
# PostToolUse hook — check for operations on sensitive files without prior Read
#
# Detects: Bash(mv/rm), Edit, or Write targeting files in bin/, .harness/, or
# package.json — and checks whether those files were Read earlier in this session.
#
# State file is maintained by harness-knowledge-track.sh which tracks all Read calls.

STATE_FILE=/tmp/claude-knowledge-capture-state.json
SENSITIVE_DIRS="bin/ .harness/"

INPUT=$(cat)
tool_name=$(echo "$INPUT" | jq -r '.tool_name // ""')
file_path=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
content=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
command=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Check if this operation targets a sensitive file
is_sensitive=false
for dir in $SENSITIVE_DIRS; do
  case "$file_path" in
    *$dir*) is_sensitive=true; break ;;
  esac
done

# For Bash, check if the command involves mv/rm on sensitive paths
if [ "$tool_name" = "Bash" ] && [ -n "$command" ]; then
  for dir in $SENSITIVE_DIRS; do
    if echo "$command" | grep -qE "(mv|rm|cp|git rm).*$dir"; then
      is_sensitive=true
      # Extract target from command for checking
      file_path=$(echo "$command" | grep -oE "$dir[^ ]*" | head -1)
      break
    fi
  done
fi

# Only check sensitive operations
if [ "$is_sensitive" != "true" ] || [ -z "$file_path" ]; then
  exit 0
fi

# Check if this file was Read earlier in the session
if [ -f "$STATE_FILE" ]; then
  read_dirs=$(jq -r '.readDirs // [] | join(" ")' "$STATE_FILE" 2>/dev/null || echo "")

  # Check if any read_dir is an ancestor of file_path
  verified=false
  file_dir=$(dirname "$file_path")
  for dir in $read_dirs; do
    case "$file_dir" in
      "$dir"|"$dir/"*) verified=true; break ;;
    esac
  done

  if [ "$verified" != "true" ]; then
    # Also check if the file itself was explicitly Read (file_path matches a read path)
    # The track hook only records directories, not individual files — conservative check

    # Emit warning via state file for Stop hook to pick up
    jq --arg op "$tool_name" --arg fp "$file_path" \
      '.sensitiveOps += [{"tool":$op,"file":$fp,"verified":false}]' \
      "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
  fi
fi

exit 0
