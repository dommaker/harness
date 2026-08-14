#!/bin/sh
# 安装 harness 仓库自身 pre-commit 钩子（工单 36）
#
# .git/hooks 不进版本库、新 clone 不带钩子；且裸名 npx harness 会解析到
# npm 同名陌生包（rsdoiel/harness@0.0.6）。本脚本是钩子的跟踪生成源，
# 落盘 dogfood 当前 HEAD 的钩子（node bin/harness.js check --staged），
# 本地确定、离线可用。
#
# 用法：npm run hooks:install
#       （可选参数：git 目录路径，默认 .git）
set -e

GIT_DIR="${1:-.git}"
HOOK_PATH="$GIT_DIR/hooks/pre-commit"

mkdir -p "$GIT_DIR/hooks"
cat > "$HOOK_PATH" <<'HOOK_EOF'
#!/bin/sh
# Harness - Pre-commit hook
# 只做快速确定性检查（< 3s），全量测试交给 CI
#
# 检查项：
#   1. harness check --staged — 约束检查（Iron Laws）
#   2. 指南警告匹配已知解法 (RKB dogfood)
#   3. 零字节源文件检测（防 sed/批量操作误清空）
#
# 工单 24：修复 set -e 与 $(...) 捕获的冲突（命令失败不再被 set -e 提前终止）；
# 移除全量 build/test（原 harness validate 检查点在低内存机器上 OOM，
# 且钩子本就声明全量测试交给 CI）。
# 工单 36：改用 node bin/harness.js（裸名 npx harness 会解析到 npm 同名陌生包；
# dogfood 当前 HEAD，本地确定、离线可用）。

set -e
RESOLUTIONS=".harness/resolutions.json"

echo "🔍 Running harness check..."
CHECK_EXIT=0
CHECK_OUTPUT=$(node bin/harness.js check --staged 2>&1) || CHECK_EXIT=$?

echo "$CHECK_OUTPUT"

if [ "$CHECK_EXIT" -ne 0 ]; then
  # Iron Law violation — auto-query resolutions for guideline warnings in output
  if [ -f "$RESOLUTIONS" ] && command -v jq >/dev/null 2>&1; then
    echo ""
    echo "📋 Known fixes for guideline warnings:"
    echo "$CHECK_OUTPUT" | grep -oP '⚠️  [a-z_]+' | while read -r line; do
      gid=$(echo "$line" | sed 's/⚠️  //')
      title=$(jq -r ".[\"$gid\"].title // empty" "$RESOLUTIONS" 2>/dev/null)
      fix=$(jq -r ".[\"$gid\"].fix // empty" "$RESOLUTIONS" 2>/dev/null)
      if [ -n "$fix" ]; then
        echo "   🔧 $title"
        echo "      $fix"
        echo ""
      fi
    done
  fi
  echo "❌ Harness constraint check failed. Fix violations before committing."
  exit 1
fi

# 零字节源文件检测（防止 sed/批量操作误清空）
echo "🔍 Checking for empty source files..."
EMPTY_FILES=$(find src/ -name '*.ts' -size 0 2>/dev/null)
if [ -n "$EMPTY_FILES" ]; then
  echo "❌ Zero-byte source files detected:"
  echo "$EMPTY_FILES"
  echo "These files may have been accidentally wiped. Restore them before committing."
  exit 1
fi

echo "✅ Pre-commit checks passed"
HOOK_EOF

chmod +x "$HOOK_PATH"
echo "✅ 已安装 $HOOK_PATH（改动钩子后重跑 npm run hooks:install 刷新）"
