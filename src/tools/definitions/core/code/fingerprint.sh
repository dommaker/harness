#!/bin/bash
# fingerprint.sh - 代码结构指纹工具
# ============================================================================
# 功能：提取代码结构签名，区分"结构性变更"和"表面变更"
# 用途：增量分析、变更影响评估、代码审查优先级排序
# ============================================================================

set -e

# 参数
FILE_PATH="${1:-}"
PROJECT_PATH="${2:-.}"
COMPARE_WITH="${3:-previous}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_debug() { echo -e "${BLUE}[DEBUG]${NC} $1"; }

# 显示帮助
show_help() {
  cat << EOF
代码结构指纹工具

用法:
  $0 <file_path> [project_path] [compare_with]

参数:
  file_path     文件路径（相对于项目根目录）
  project_path  项目根路径（默认: 当前目录）
  compare_with  对比目标（默认: previous）
                - "previous" - 与上一个 commit 对比
                - "base" - 与基准分支对比
                - <commit_hash> - 具体的 commit

输出:
  JSON 格式的结构指纹和变更分析结果

示例:
  $0 src/utils.ts
  $0 src/utils.ts /home/user/project previous
  $0 src/api.ts . HEAD~3
EOF
  exit 0
}

# 检查参数
if [[ "$1" == "-h" || "$1" == "--help" || -z "$FILE_PATH" ]]; then
  show_help
fi

cd "$PROJECT_PATH"

# 检查文件是否存在
if [[ ! -f "$FILE_PATH" ]]; then
  log_error "文件不存在: $FILE_PATH"
  exit 1
fi

# 获取文件扩展名和语言
EXT="${FILE_PATH##*.}"
LANG_MAP=(
  "ts:typescript"
  "tsx:typescript"
  "js:javascript"
  "jsx:javascript"
  "py:python"
  "go:go"
  "rs:rust"
  "java:java"
  "cpp:c++"
  "c:c"
  "rb:ruby"
  "php:php"
  "swift:swift"
  "kt:kotlin"
  "scala:scala"
  "cs:c#"
  "vue:vue"
  "svelte:svelte"
  "css:css"
  "scss:scss"
  "html:html"
  "json:json"
  "yaml:yaml"
  "md:markdown"
  "sh:bash"
)

get_language() {
  local ext="$1"
  for entry in "${LANG_MAP[@]}"; do
    if [[ "$entry" == "$ext:"* ]]; then
      echo "${entry#*:}"
      return
    fi
  done
  echo "unknown"
}

LANGUAGE=$(get_language "$EXT")

# 提取代码结构
extract_structure() {
  local file="$1"
  local lang="$2"
  
  case "$lang" in
    typescript|javascript)
      # 提取函数、类、导入
      local functions=$(grep -oE "(function\s+[a-zA-Z_][a-zA-Z0-9_]*|const\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*(async\s*)?\(|const\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*function)" "$file" 2>/dev/null | sed 's/function\s\|const\s\|=\s*(\|async\s//g' | tr -d '()' || echo "")
      local classes=$(grep -oE "(class|interface|type)\s+[a-zA-Z_][a-zA-Z0-9_]*" "$file" 2>/dev/null | awk '{print $2}' || echo "")
      local imports=$(grep -oE "import.*from\s+['\"][^'\"]+['\"]" "$file" 2>/dev/null | sed "s/.*from\s*['\"]//;s/['\"]//g" || echo "")
      ;;
    python)
      local functions=$(grep -oE "^def\s+[a-zA-Z_][a-zA-Z0-9_]*" "$file" 2>/dev/null | sed 's/def\s//' || echo "")
      local classes=$(grep -oE "^class\s+[a-zA-Z_][a-zA-Z0-9_]*" "$file" 2>/dev/null | sed 's/class\s//' || echo "")
      local imports=$(grep -oE "^import\s+[a-zA-Z_][a-zA-Z0-9_.]*|^from\s+[a-zA-Z_][a-zA-Z0-9_.]*\s+import" "$file" 2>/dev/null | head -20 || echo "")
      ;;
    go)
      local functions=$(grep -oE "func\s+(\([a-zA-Z_][a-zA-Z0-9_]*\s+\*?[a-zA-Z_][a-zA-Z0-9_]*\)\s+)?[a-zA-Z_][a-zA-Z0-9_]*" "$file" 2>/dev/null | sed 's/func\s\|func\s*(.*)\s//g' || echo "")
      local classes=$(grep -oE "type\s+[a-zA-Z_][a-zA-Z0-9_]*\s+struct" "$file" 2>/dev/null | awk '{print $2}' || echo "")
      local imports=$(grep -oE "import\s+[\"]?[^\"\n]+[\"]?" "$file" 2>/dev/null | sed 's/import\s\|\"//g' || echo "")
      ;;
    *)
      # 通用提取：函数定义
      local functions=$(grep -oE "(function|func|def|fn)\s+[a-zA-Z_][a-zA-Z0-9_]*" "$file" 2>/dev/null | awk '{print $2}' || echo "")
      local classes=$(grep -oE "(class|struct|interface)\s+[a-zA-Z_][a-zA-Z0-9_]*" "$file" 2>/dev/null | awk '{print $2}' || echo "")
      local imports=""
      ;;
  esac
  
  # 输出 JSON
  echo "{\"functions\":[$(echo "$functions" | tr '\n' ',' | sed 's/,$//' | while read f; do [[ -n "$f" ]] && echo "\"$f\""; done | tr '\n' ',' | sed 's/,$//')],\"classes\":[$(echo "$classes" | tr '\n' ',' | sed 's/,$//' | while read c; do [[ -n "$c" ]] && echo "\"$c\""; done | tr '\n' ',' | sed 's/,$//')],\"imports\":[$(echo "$imports" | tr '\n' ',' | sed 's/,$//' | while read i; do [[ -n "$i" ]] && echo "\"$i\""; done | tr '\n' ',' | sed 's/,$//')]}"
}

# 计算内容哈希
compute_hash() {
  local file="$1"
  sha256sum "$file" 2>/dev/null | awk '{print $1}' || md5sum "$file" 2>/dev/null | awk '{print $1}'
}

# 获取 git diff
get_git_diff() {
  local file="$1"
  local compare="$2"
  
  case "$compare" in
    previous)
      git diff HEAD~1 HEAD -- "$file" 2>/dev/null || echo ""
      ;;
    base)
      local base_branch=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")
      git diff "$base_branch" HEAD -- "$file" 2>/dev/null || echo ""
      ;;
    *)
      git diff "$compare" HEAD -- "$file" 2>/dev/null || echo ""
      ;;
  esac
}

# 分析变更级别
analyze_change_level() {
  local diff="$1"
  
  if [[ -z "$diff" ]]; then
    echo "NONE"
    return
  fi
  
  # 检查是否有结构变更
  local structural_patterns="(function|func|def|class|interface|struct|type|enum)\s+[a-zA-Z_]"
  local structural_changes=$(echo "$diff" | grep -E "^[\+\-].*$structural_patterns" | grep -v "^[\+\-][\+\-][\+\-]" | wc -l)
  
  # 检查是否有导入变更
  local import_patterns="(import|require|from\s+['\"])"
  local import_changes=$(echo "$diff" | grep -E "^[\+\-].*$import_patterns" | grep -v "^[\+\-][\+\-][\+\-]" | wc -l)
  
  # 检查是否只有注释或格式变更
  local cosmetic_only=true
  local added_lines=$(echo "$diff" | grep "^+" | grep -v "^+++" | wc -l)
  local removed_lines=$(echo "$diff" | grep "^-" | grep -v "^---" | wc -l)
  
  # 检查非注释变更
  local code_lines=$(echo "$diff" | grep -E "^[\+\-]" | grep -v "^[\+\-][\+\-][\+\-]" | grep -v "^\+\s*(//|/\*|\*|<!--|#)" | wc -l)
  
  if [[ $structural_changes -gt 0 || $import_changes -gt 0 ]]; then
    echo "STRUCTURAL"
  elif [[ $code_lines -gt 0 ]]; then
    echo "COSMETIC"
  else
    echo "NONE"
  fi
}

# 提取变更详情
extract_change_details() {
  local diff="$1"
  local level="$2"
  local details=()
  
  if [[ "$level" == "NONE" ]]; then
    echo "[]"
    return
  fi
  
  # 提取新增的函数
  local new_functions=$(echo "$diff" | grep "^+" | grep -oE "(function|func|def)\s+[a-zA-Z_][a-zA-Z0-9_]*" | sed 's/function\s\|func\s\|def\s//' | head -5)
  for f in $new_functions; do
    details+=("added function: $f")
  done
  
  # 提取删除的函数
  local removed_functions=$(echo "$diff" | grep "^-" | grep -oE "(function|func|def)\s+[a-zA-Z_][a-zA-Z0-9_]*" | sed 's/function\s\|func\s\|def\s//' | head -5)
  for f in $removed_functions; do
    details+=("removed function: $f")
  done
  
  # 提取新增的类
  local new_classes=$(echo "$diff" | grep "^+" | grep -oE "(class|interface|struct|type)\s+[a-zA-Z_][a-zA-Z0-9_]*" | awk '{print $2}' | head -5)
  for c in $new_classes; do
    details+=("added class/interface: $c")
  done
  
  # 提取新增的导入
  local new_imports=$(echo "$diff" | grep "^+" | grep -oE "import.*from\s+['\"][^'\"]+['\"]" | sed "s/.*from\s*['\"]//;s/['\"]//g" | head -5)
  for i in $new_imports; do
    details+=("added import: $i")
  done
  
  # 输出 JSON 数组
  local json="["
  for d in "${details[@]}"; do
    [[ -n "$d" ]] && json+="\"$d\","
  done
  json="${json%,}]"
  echo "$json"
}

# 主流程
log_info "分析文件: $FILE_PATH"
log_info "语言: $LANGUAGE"
log_info "对比目标: $COMPARE_WITH"

# 提取当前结构
CURRENT_STRUCTURE=$(extract_structure "$FILE_PATH" "$LANGUAGE")
CONTENT_HASH=$(compute_hash "$FILE_PATH")

# 获取 diff 并分析变更
DIFF=$(get_git_diff "$FILE_PATH" "$COMPARE_WITH")
CHANGE_LEVEL=$(analyze_change_level "$DIFF")
CHANGE_DETAILS=$(extract_change_details "$DIFF" "$CHANGE_LEVEL")

# 输出结果
cat << EOF
{
  "file_path": "$FILE_PATH",
  "language": "$LANGUAGE",
  "fingerprint": $CURRENT_STRUCTURE,
  "content_hash": "$CONTENT_HASH",
  "change_level": "$CHANGE_LEVEL",
  "details": $CHANGE_DETAILS
}
EOF

log_info "完成"
