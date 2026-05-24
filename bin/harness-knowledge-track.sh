#!/bin/bash
# PostToolUse hook — track deep analysis + session metrics
# Matcher: EnterPlanMode|Agent|Read|Write|Edit|Bash (broad coverage)
# DailyReflection: enriched session:summary events for behavioral analysis

STATE_FILE=/tmp/claude-knowledge-capture-state.json
INPUT=$(cat)

tool_name=$(echo "$INPUT" | jq -r '.tool_name // ""')
file_path=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Init state file if missing (tool: claude|codex|opencode|etc)
_tool=$(echo "${CLAUDE_CODE_TOOL_NAME:-claude}" | tr '[:upper:]' '[:lower:]')
[ -f "$STATE_FILE" ] || echo "{\"planned\":false,\"explored\":false,\"readDirs\":[],\"captured\":false,\"turnCount\":0,\"startTime\":$(date +%s)000,\"tool\":\"$_tool\"}" > "$STATE_FILE"

# Always increment turn counter on substantive tools
case "$tool_name" in
  EnterPlanMode)
    jq '.planned = true | .turnCount += 1' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    ;;
  Agent)
    # Agent(Explore) spawned → deep analysis signal
    _agent_type=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')
    if [ "$_agent_type" = "Explore" ]; then
      jq '.explored = true | .turnCount += 1' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    fi
    ;;
  Read)
    if [ -n "$file_path" ]; then
      dir=$(dirname "$file_path")
      if [ "$dir" != "." ] && [ "$dir" != "/" ]; then
        jq --arg d "$dir" '.readDirs += [$d] | .readDirs |= unique | .turnCount += 1' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
      fi
    fi
    ;;
  Write|Edit)
    jq '.turnCount += 1' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    case "$file_path" in
      *.harness/knowledge-docs/*|*.harness/knowledge/*|*/memory/*.md|*/docs/*.md)
        jq '.captured = true' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
        ;;
    esac
    ;;
  Bash)
    jq '.turnCount += 1' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    ;;
esac
