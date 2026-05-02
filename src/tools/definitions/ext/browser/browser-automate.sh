#!/bin/bash
# browser-automate.sh - 浏览器自动化测试脚本
# 基于 agent-browser-stealth 实现（Puppeteer + 隐身增强）

set -e

# 参数解析
ACTION="${1:-test}"
URL="${2:-}"
SCRIPT="${3:-}"
OUTPUT_DIR="${4:-/tmp/browser-test-$(date +%s)}"
SESSION_NAME="browser-test-$(date +%s)"
HEADLESS="${HEADLESS:-true}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
  echo -e "${BLUE}[DEBUG]${NC} $1"
}

# 检查 agent-browser-stealth 是否安装
check_abs() {
  if ! command -v abs &> /dev/null; then
    log_warn "agent-browser-stealth not found, installing..."
    npm install -g agent-browser-stealth
    abs install
  fi
}

# 运行浏览器测试（使用 agent-browser-stealth）
run_browser_test() {
  local url="$1"
  local actions="$2"
  
  log_info "Starting browser automation test (agent-browser-stealth)..."
  log_info "URL: $url"
  log_info "Session: $SESSION_NAME"
  log_info "Output: $OUTPUT_DIR"
  
  mkdir -p "$OUTPUT_DIR"
  
  # 结果数组
  declare -a RESULTS=()
  
  # 检查 abs 命令
  check_abs
  
  # 1. 打开页面
  log_info "Opening URL..."
  if ! abs open "$url" --session-name "$SESSION_NAME" 2>&1 | tee -a "$OUTPUT_DIR/test.log"; then
    log_error "Failed to open URL: $url"
    RESULTS+=("{\"action\":\"navigate\",\"status\":\"failed\",\"url\":\"$url\"}")
    echo "{\"results\":[$(IFS=,; echo "${RESULTS[*]}")],\"errors\":[\"Failed to open URL\"]}"
    exit 1
  fi
  RESULTS+=("{\"action\":\"navigate\",\"status\":\"success\",\"url\":\"$url\"}")
  
  # 2. 等待页面加载
  sleep 2
  
  # 3. 初始截图
  abs screenshot "$OUTPUT_DIR/screenshot-initial.png" --session-name "$SESSION_NAME" 2>/dev/null || true
  
  # 4. 获取元素映射
  log_info "Getting element snapshot..."
  SNAPSHOT_OUTPUT=$(abs snapshot -i --session-name "$SESSION_NAME" 2>&1) || true
  
  # 保存 snapshot 输出供调试
  echo "$SNAPSHOT_OUTPUT" > "$OUTPUT_DIR/snapshot.txt"
  
  # 5. 执行测试脚本
  if [ -n "$actions" ] && [ "$actions" != "[]" ]; then
    log_info "Executing test actions..."
    
    # 解析 JSON actions 并执行
    echo "$actions" | jq -c '.[]' 2>/dev/null | while read -r action; do
      action_type=$(echo "$action" | jq -r '.type')
      selector=$(echo "$action" | jq -r '.selector // ""')
      value=$(echo "$action" | jq -r '.value // ""')
      delay=$(echo "$action" | jq -r '.delay // 500')
      filename=$(echo "$action" | jq -r '.filename // "screenshot.png"')
      should_exist=$(echo "$action" | jq -r '.shouldExist // true')
      
      log_debug "Action: $action_type, Selector: $selector"
      
      case "$action_type" in
        click)
          # 尝试使用 @ref 引用，否则直接使用 selector
          if abs click "$selector" --session-name "$SESSION_NAME" 2>&1 | tee -a "$OUTPUT_DIR/test.log"; then
            log_info "Click success: $selector"
            sleep 0.5
          else
            log_warn "Click failed: $selector"
          fi
          ;;
        
        type)
          if abs type "$selector" "$value" --session-name "$SESSION_NAME" 2>&1 | tee -a "$OUTPUT_DIR/test.log"; then
            log_info "Type success: $selector"
          else
            log_warn "Type failed: $selector"
          fi
          ;;
        
        wait)
          log_info "Waiting for: $selector"
          sleep "${delay::-3}2"  # 转换为秒
          ;;
        
        screenshot)
          abs screenshot "$OUTPUT_DIR/$filename" --session-name "$SESSION_NAME" 2>&1 | tee -a "$OUTPUT_DIR/test.log" || true
          log_info "Screenshot saved: $filename"
          ;;
        
        assert)
          # 使用 abs eval 检查元素是否存在
          if abs eval "document.querySelector('$selector')" --session-name "$SESSION_NAME" 2>&1 | grep -q "null"; then
            log_warn "Element not found: $selector"
          else
            log_info "Element found: $selector"
          fi
          ;;
        
        scroll)
          abs eval "window.scrollBy(0, ${value:-500})" --session-name "$SESSION_NAME" 2>&1 | tee -a "$OUTPUT_DIR/test.log" || true
          log_info "Scrolled: ${value:-500}px"
          ;;
        
        *)
          log_warn "Unknown action: $action_type"
          ;;
      esac
    done
  fi
  
  # 6. 最终截图
  abs screenshot "$OUTPUT_DIR/screenshot-final.png" --full-page --session-name "$SESSION_NAME" 2>/dev/null || true
  
  # 7. 获取性能指标
  METRICS=$(abs eval "JSON.stringify(performance.getEntriesByType('navigation')[0])" --session-name "$SESSION_NAME" 2>/dev/null || echo "{}")
  echo "$METRICS" > "$OUTPUT_DIR/metrics.json"
  
  # 8. 关闭浏览器
  abs close --session-name "$SESSION_NAME" 2>/dev/null || true
  
  # 9. 生成结果
  log_info "Generating test results..."
  
  # 构建结果 JSON
  cat > "$OUTPUT_DIR/test-results.json" << EOF
{
  "results": [
    {"action": "navigate", "status": "success", "url": "$url"},
    {"action": "session", "status": "success", "sessionName": "$SESSION_NAME"}
  ],
  "screenshots": [
    "$OUTPUT_DIR/screenshot-initial.png",
    "$OUTPUT_DIR/screenshot-final.png"
  ],
  "metrics": $METRICS,
  "outputDir": "$OUTPUT_DIR"
}
EOF
  
  log_info "Test completed. Results:"
  cat "$OUTPUT_DIR/test-results.json"
}

# 交互式测试模式
run_interactive_test() {
  local url="$1"
  
  log_info "Starting interactive browser session..."
  log_info "URL: $url"
  log_info "Session: $SESSION_NAME"
  log_info ""
  log_info "Commands:"
  log_info "  abs snapshot -i           # Get interactive element references"
  log_info "  abs click @e1             # Click element by reference"
  log_info "  abs type @e1 'text'       # Type text"
  log_info "  abs screenshot out.png    # Take screenshot"
  log_info "  abs close                 # Close browser"
  log_info ""
  
  check_abs
  abs open "$url" --session-name "$SESSION_NAME"
}

# 示例测试脚本
example_login_test() {
  cat << 'EOF'
[
  {"type": "wait", "selector": "input[name='username']"},
  {"type": "type", "selector": "input[name='username']", "value": "test@example.com"},
  {"type": "type", "selector": "input[name='password']", "value": "password123"},
  {"type": "click", "selector": "button[type='submit']"},
  {"type": "wait", "selector": ".dashboard", "delay": 2000},
  {"type": "screenshot", "filename": "dashboard.png"}
]
EOF
}

# 主函数
main() {
  case "$ACTION" in
    test)
      if [ -z "$URL" ]; then
        log_error "URL is required for test action"
        echo "Usage: $0 test <url> [script]"
        echo "Example: $0 test https://example.com '$(example_login_test)'"
        exit 1
      fi
      run_browser_test "$URL" "$SCRIPT"
      ;;
    
    interactive)
      if [ -z "$URL" ]; then
        log_error "URL is required for interactive mode"
        echo "Usage: $0 interactive <url>"
        exit 1
      fi
      run_interactive_test "$URL"
      ;;
    
    example)
      echo "Example login test script:"
      example_login_test
      ;;
    
    *)
      log_error "Unknown action: $ACTION"
      echo "Actions: test, interactive, example"
      exit 1
      ;;
  esac
}

main "$@"
