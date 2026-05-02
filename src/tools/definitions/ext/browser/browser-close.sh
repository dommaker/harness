#!/bin/bash
# browser-close.sh - 关闭浏览器会话
# ============================================================================
# 功能：关闭浏览器会话并清理资源
# 底层：使用 agent-browser-stealth (abs)
# 用途：E2E 测试、浏览器自动化结束后清理
# ============================================================================

set -e

# 参数
SESSION_ID="${1:-}"
SAVE_SCREENSHOTS="${2:-true}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/browser-screenshots}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 显示帮助
show_help() {
  cat << EOF
关闭浏览器会话

用法:
  $0 <session_id> [save_screenshots]

参数:
  session_id       浏览器会话 ID
  save_screenshots 是否保存截图 (true/false，默认 true)

环境变量:
  OUTPUT_DIR  截图输出目录（默认 /tmp/browser-screenshots）

输出:
  JSON 格式的关闭结果

示例:
  $0 browser-session-123456
  $0 browser-session-123456 true
EOF
  exit 0
}

# 检查参数
if [[ "$1" == "-h" || "$1" == "--help" || -z "$SESSION_ID" ]]; then
  show_help
fi

# 检查 abs 是否安装
if ! command -v abs &> /dev/null; then
  log_error "agent-browser-stealth (abs) 未安装"
  echo '{"success": false, "error": "abs not found"}'
  exit 1
fi

log_info "关闭浏览器会话: $SESSION_ID"

SCREENSHOTS="[]"

# 保存截图（可选）
if [[ "$SAVE_SCREENSHOTS" == "true" ]]; then
  log_info "保存截图..."
  mkdir -p "$OUTPUT_DIR"
  
  SCREENSHOT_FILE="$OUTPUT_DIR/${SESSION_ID}-final.png"
  
  # 尝试截图
  if abs screenshot "$SCREENSHOT_FILE" --session-name "$SESSION_ID" 2>/dev/null; then
    SCREENSHOTS="[\"$SCREENSHOT_FILE\"]"
    log_info "截图已保存: $SCREENSHOT_FILE"
  fi
fi

# 关闭浏览器
abs close --session-name "$SESSION_ID" 2>/dev/null

# 检查是否成功
if [[ $? -eq 0 ]]; then
  log_info "浏览器会话已关闭"
  
  cat << EOF
{
  "success": true,
  "session_id": "$SESSION_ID",
  "screenshots": $SCREENSHOTS,
  "output_dir": "$OUTPUT_DIR"
}
EOF
else
  cat << EOF
{
  "success": false,
  "session_id": "$SESSION_ID",
  "error": "Failed to close browser"
}
EOF
  exit 1
fi
