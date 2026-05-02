#!/bin/bash
# notify.sh - 发送通知
# ============================================================================
# 功能：发送通知到指定渠道
# 渠道：discord, queue (降级方案)
# 用途：工作流完成通知、审核结果通知、状态更新
# ============================================================================

set -e

# 参数
CHANNEL="${1:-discord}"
MESSAGE="${2:-}"
TITLE="${3:-}"

# 通知队列目录
NOTIFICATION_DIR="${NOTIFICATION_DIR:-/tmp/agent-notifications}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 显示帮助
show_help() {
  cat << EOF
发送通知

用法:
  $0 <channel> <message> [title]

参数:
  channel  通知渠道 (discord/queue)
  message  通知内容
  title    通知标题（可选）

渠道说明:
  discord  尝试发送到 Discord（需要 sessions_send）
  queue    写入通知队列文件（降级方案）

环境变量:
  NOTIFICATION_DIR  通知队列目录（默认 /tmp/agent-notifications）

输出:
  JSON 格式的发送结果

示例:
  $0 discord "测试完成" "通知标题"
  $0 queue "审核完成" "审核结果"
EOF
  exit 0
}

# 检查参数
if [[ "$1" == "-h" || "$1" == "--help" || -z "$MESSAGE" ]]; then
  show_help
fi

# 生成消息 ID
MESSAGE_ID="notify-$(date +%s)-$$"

# 构建通知内容
if [[ -n "$TITLE" ]]; then
  FULL_MESSAGE="**$TITLE**\n$MESSAGE"
else
  FULL_MESSAGE="$MESSAGE"
fi

# 根据渠道发送
case "$CHANNEL" in
  discord)
    # 方案 1: 尝试使用 sessions_send（如果有 OpenClaw 环境）
    # 方案 2: 降级到队列
    
    # 检查是否有 sessions_send 工具
    # 这里我们写入队列，由 OpenClaw 的 heartbeat 检查并发送
    mkdir -p "$NOTIFICATION_DIR"
    
    NOTIFICATION_FILE="$NOTIFICATION_DIR/${MESSAGE_ID}.json"
    
    cat > "$NOTIFICATION_FILE" << EOF
{
  "id": "$MESSAGE_ID",
  "channel": "discord",
  "title": "$TITLE",
  "content": $(echo "$MESSAGE" | jq -Rs .),
  "timestamp": "$(date -Iseconds)",
  "status": "pending"
}
EOF
    
    log_info "通知已写入队列: $NOTIFICATION_FILE"
    
    cat << EOF
{
  "success": true,
  "message_id": "$MESSAGE_ID",
  "channel": "discord",
  "status": "queued",
  "file": "$NOTIFICATION_FILE"
}
EOF
    ;;
  
  queue)
    # 直接写入队列
    mkdir -p "$NOTIFICATION_DIR"
    
    NOTIFICATION_FILE="$NOTIFICATION_DIR/${MESSAGE_ID}.json"
    
    cat > "$NOTIFICATION_FILE" << EOF
{
  "id": "$MESSAGE_ID",
  "channel": "$CHANNEL",
  "title": "$TITLE",
  "content": $(echo "$MESSAGE" | jq -Rs .),
  "timestamp": "$(date -Iseconds)",
  "status": "pending"
}
EOF
    
    log_info "通知已写入队列: $NOTIFICATION_FILE"
    
    cat << EOF
{
  "success": true,
  "message_id": "$MESSAGE_ID",
  "channel": "$CHANNEL",
  "status": "queued",
  "file": "$NOTIFICATION_FILE"
}
EOF
    ;;
  
  *)
    log_error "不支持的通知渠道: $CHANNEL"
    cat << EOF
{
  "success": false,
  "error": "Unsupported channel: $CHANNEL",
  "supported_channels": ["discord", "queue"]
}
EOF
    exit 1
    ;;
esac
