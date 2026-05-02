#!/bin/bash
# register-language.sh - 注册编程语言支持
# ============================================================================
# 功能：为代码解析器添加新语言支持
# 用途：项目初始化时自动检测语言、多语言项目分析
# ============================================================================

set -e

# 配置文件路径
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/code-parser"
LANGUAGES_FILE="$CONFIG_DIR/languages.json"

# 参数
LANGUAGE="${1:-}"
EXTENSIONS="${2:-}"
PARSER_CONFIG="${3:-}"

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

# 预定义语言配置
declare -A PREDEFINED_LANGUAGES

# TypeScript
PREDEFINED_LANGUAGES["typescript"]='{
  "name": "typescript",
  "extensions": [".ts", ".tsx", ".mts", ".cts"],
  "features": ["functions", "classes", "interfaces", "types", "enums", "imports", "exports", "decorators", "generics"],
  "function_patterns": ["function {name}({params})", "const {name} = ({params}) =>"],
  "class_patterns": ["class {name}", "interface {name}", "type {name}"],
  "import_patterns": ["import {specifiers} from \"{source}\"", "import {source}"],
  "tree_sitter_grammar": "tree-sitter-typescript"
}'

# JavaScript
PREDEFINED_LANGUAGES["javascript"]='{
  "name": "javascript",
  "extensions": [".js", ".jsx", ".mjs", ".cjs"],
  "features": ["functions", "classes", "imports", "exports"],
  "function_patterns": ["function {name}({params})", "const {name} = ({params}) =>"],
  "class_patterns": ["class {name}"],
  "import_patterns": ["import {specifiers} from \"{source}\"", "require(\"{source}\")"],
  "tree_sitter_grammar": "tree-sitter-javascript"
}'

# Python
PREDEFINED_LANGUAGES["python"]='{
  "name": "python",
  "extensions": [".py", ".pyw", ".pyi"],
  "features": ["functions", "classes", "decorators", "imports"],
  "function_patterns": ["def {name}({params}):", "async def {name}({params}):"],
  "class_patterns": ["class {name}:", "class {name}({bases}):"],
  "import_patterns": ["import {source}", "from {source} import {specifiers}"],
  "tree_sitter_grammar": "tree-sitter-python"
}'

# Go
PREDEFINED_LANGUAGES["go"]='{
  "name": "go",
  "extensions": [".go"],
  "features": ["functions", "structs", "interfaces", "imports"],
  "function_patterns": ["func {name}({params})", "func ({receiver}) {name}({params})"],
  "class_patterns": ["type {name} struct", "type {name} interface"],
  "import_patterns": ["import \"{source}\"", "import {alias} \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-go"
}'

# Rust
PREDEFINED_LANGUAGES["rust"]='{
  "name": "rust",
  "extensions": [".rs"],
  "features": ["functions", "structs", "enums", "traits", "impls", "imports"],
  "function_patterns": ["fn {name}({params})", "pub fn {name}({params})"],
  "class_patterns": ["struct {name}", "enum {name}", "trait {name}"],
  "import_patterns": ["use {source};", "use {source}::{specifiers};"],
  "tree_sitter_grammar": "tree-sitter-rust"
}'

# Java
PREDEFINED_LANGUAGES["java"]='{
  "name": "java",
  "extensions": [".java"],
  "features": ["methods", "classes", "interfaces", "annotations", "imports"],
  "function_patterns": ["{modifiers} {return} {name}({params})"],
  "class_patterns": ["class {name}", "interface {name}", "enum {name}"],
  "import_patterns": ["import {source};"],
  "tree_sitter_grammar": "tree-sitter-java"
}'

# C++
PREDEFINED_LANGUAGES["c++"]='{
  "name": "c++",
  "extensions": [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
  "features": ["functions", "classes", "structs", "namespaces", "includes"],
  "function_patterns": ["{return} {name}({params})", "{return} {class}::{name}({params})"],
  "class_patterns": ["class {name}", "struct {name}"],
  "import_patterns": ["#include <{source}>", "#include \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-cpp"
}'

# C
PREDEFINED_LANGUAGES["c"]='{
  "name": "c",
  "extensions": [".c", ".h"],
  "features": ["functions", "structs", "includes"],
  "function_patterns": ["{return} {name}({params})"],
  "class_patterns": ["struct {name}"],
  "import_patterns": ["#include <{source}>", "#include \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-c"
}'

# Ruby
PREDEFINED_LANGUAGES["ruby"]='{
  "name": "ruby",
  "extensions": [".rb", ".rake", ".gemspec"],
  "features": ["methods", "classes", "modules", "requires"],
  "function_patterns": ["def {name}({params})", "def self.{name}({params})"],
  "class_patterns": ["class {name}", "module {name}"],
  "import_patterns": ["require \"{source}\"", "require_relative \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-ruby"
}'

# PHP
PREDEFINED_LANGUAGES["php"]='{
  "name": "php",
  "extensions": [".php", ".phtml"],
  "features": ["functions", "classes", "traits", "interfaces", "namespaces"],
  "function_patterns": ["function {name}({params})", "public function {name}({params})"],
  "class_patterns": ["class {name}", "trait {name}", "interface {name}"],
  "import_patterns": ["use {source};", "require \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-php"
}'

# Kotlin
PREDEFINED_LANGUAGES["kotlin"]='{
  "name": "kotlin",
  "extensions": [".kt", ".kts"],
  "features": ["functions", "classes", "objects", "interfaces", "imports"],
  "function_patterns": ["fun {name}({params})", "suspend fun {name}({params})"],
  "class_patterns": ["class {name}", "object {name}", "interface {name}"],
  "import_patterns": ["import {source}"],
  "tree_sitter_grammar": "tree-sitter-kotlin"
}'

# Swift
PREDEFINED_LANGUAGES["swift"]='{
  "name": "swift",
  "extensions": [".swift"],
  "features": ["functions", "classes", "structs", "protocols", "enums", "imports"],
  "function_patterns": ["func {name}({params})", "static func {name}({params})"],
  "class_patterns": ["class {name}", "struct {name}", "protocol {name}", "enum {name}"],
  "import_patterns": ["import {source}"],
  "tree_sitter_grammar": "tree-sitter-swift"
}'

# Scala
PREDEFINED_LANGUAGES["scala"]='{
  "name": "scala",
  "extensions": [".scala", ".sc"],
  "features": ["functions", "classes", "traits", "objects", "imports"],
  "function_patterns": ["def {name}({params})", "def {name}({params}): {return}"],
  "class_patterns": ["class {name}", "trait {name}", "object {name}", "case class {name}"],
  "import_patterns": ["import {source}", "import {source}.{specifiers}"],
  "tree_sitter_grammar": "tree-sitter-scala"
}'

# C#
PREDEFINED_LANGUAGES["c#"]='{
  "name": "c#",
  "extensions": [".cs"],
  "features": ["methods", "classes", "interfaces", "structs", "enums", "namespaces"],
  "function_patterns": ["{modifiers} {return} {name}({params})"],
  "class_patterns": ["class {name}", "interface {name}", "struct {name}", "enum {name}"],
  "import_patterns": ["using {source};"],
  "tree_sitter_grammar": "tree-sitter-c-sharp"
}'

# Vue
PREDEFINED_LANGUAGES["vue"]='{
  "name": "vue",
  "extensions": [".vue"],
  "features": ["components", "props", "methods", "computed", "watchers"],
  "function_patterns": ["{name}({params})"],
  "class_patterns": ["name: \"{name}\""],
  "import_patterns": ["import {source} from \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-vue"
}'

# Svelte
PREDEFINED_LANGUAGES["svelte"]='{
  "name": "svelte",
  "extensions": [".svelte"],
  "features": ["components", "props", "reactive"],
  "function_patterns": ["function {name}({params})"],
  "class_patterns": [],
  "import_patterns": ["import {source} from \"{source}\""],
  "tree_sitter_grammar": "tree-sitter-svelte"
}'

# CSS
PREDEFINED_LANGUAGES["css"]='{
  "name": "css",
  "extensions": [".css"],
  "features": ["selectors", "properties", "variables"],
  "function_patterns": [],
  "class_patterns": [],
  "import_patterns": ["@import \"{source}\";"],
  "tree_sitter_grammar": "tree-sitter-css"
}'

# SCSS
PREDEFINED_LANGUAGES["scss"]='{
  "name": "scss",
  "extensions": [".scss", ".sass"],
  "features": ["selectors", "properties", "variables", "mixins"],
  "function_patterns": ["@mixin {name}({params})"],
  "class_patterns": [],
  "import_patterns": ["@import \"{source}\";", "@use \"{source}\";"],
  "tree_sitter_grammar": "tree-sitter-scss"
}'

# HTML
PREDEFINED_LANGUAGES["html"]='{
  "name": "html",
  "extensions": [".html", ".htm"],
  "features": ["elements", "attributes"],
  "function_patterns": [],
  "class_patterns": [],
  "import_patterns": [],
  "tree_sitter_grammar": "tree-sitter-html"
}'

# JSON
PREDEFINED_LANGUAGES["json"]='{
  "name": "json",
  "extensions": [".json"],
  "features": ["objects", "arrays"],
  "function_patterns": [],
  "class_patterns": [],
  "import_patterns": [],
  "tree_sitter_grammar": "tree-sitter-json"
}'

# YAML
PREDEFINED_LANGUAGES["yaml"]='{
  "name": "yaml",
  "extensions": [".yaml", ".yml"],
  "features": ["mappings", "sequences"],
  "function_patterns": [],
  "class_patterns": [],
  "import_patterns": [],
  "tree_sitter_grammar": "tree-sitter-yaml"
}'

# Markdown
PREDEFINED_LANGUAGES["markdown"]='{
  "name": "markdown",
  "extensions": [".md", ".markdown"],
  "features": ["headings", "lists", "links", "code_blocks"],
  "function_patterns": [],
  "class_patterns": [],
  "import_patterns": [],
  "tree_sitter_grammar": "tree-sitter-markdown"
}'

# Bash
PREDEFINED_LANGUAGES["bash"]='{
  "name": "bash",
  "extensions": [".sh", ".bash", ".zsh"],
  "features": ["functions", "variables", "sources"],
  "function_patterns": ["{name}() {{", "function {name}() {{"],
  "class_patterns": [],
  "import_patterns": ["source {source}", ". {source}"],
  "tree_sitter_grammar": "tree-sitter-bash"
}'

# SQL
PREDEFINED_LANGUAGES["sql"]='{
  "name": "sql",
  "extensions": [".sql"],
  "features": ["tables", "views", "functions", "procedures"],
  "function_patterns": ["CREATE FUNCTION {name}", "CREATE PROCEDURE {name}"],
  "class_patterns": ["CREATE TABLE {name}", "CREATE VIEW {name}"],
  "import_patterns": [],
  "tree_sitter_grammar": "tree-sitter-sql"
}'

# 显示帮助
show_help() {
  cat << EOF
注册编程语言支持

用法:
  $0 <language> [extensions] [parser_config]

参数:
  language     语言名称（如 typescript, python, go）
  extensions   文件扩展名列表，逗号分隔（如 .ts,.tsx）
  parser_config 自定义解析器配置（JSON 字符串）

预定义语言:
$(echo "${!PREDEFINED_LANGUAGES[@]}" | tr ' ' '\n' | sort | head -20 | while read l; do echo "  - $l"; done)
  ... 共 ${#PREDEFINED_LANGUAGES[@]} 种语言

示例:
  # 注册预定义语言
  $0 python

  # 注册自定义扩展名
  $0 typescript ".ts,.tsx,.mts"

  # 注册新语言
  $0 elixir ".ex,.exs" '{"features": ["functions", "modules"]}'

  # 列出所有已注册语言
  $0 --list

  # 显示语言详情
  $0 --show python
EOF
  exit 0
}

# 初始化配置目录
init_config() {
  mkdir -p "$CONFIG_DIR"
  if [[ ! -f "$LANGUAGES_FILE" ]]; then
    echo '{}' > "$LANGUAGES_FILE"
  fi
}

# 列出已注册语言
list_languages() {
  init_config
  
  echo "已注册语言:"
  echo ""
  
  # 预定义语言
  echo "预定义语言 (${#PREDEFINED_LANGUAGES[@]} 种):"
  for lang in "${!PREDEFINED_LANGUAGES[@]}"; do
    local config=$(echo "${PREDEFINED_LANGUAGES[$lang]}" | jq -r '.name + " - " + (.extensions | join(", "))')
    echo "  - $config"
  done | sort
  
  # 用户注册的语言
  if [[ -s "$LANGUAGES_FILE" ]]; then
    local user_count=$(jq 'keys | length' "$LANGUAGES_FILE" 2>/dev/null || echo "0")
    if [[ "$user_count" -gt 0 ]]; then
      echo ""
      echo "用户注册语言 ($user_count 种):"
      jq -r 'to_entries[] | "  - \(.key) - \(.value.extensions | join(\", \"))"' "$LANGUAGES_FILE" 2>/dev/null
    fi
  fi
}

# 显示语言详情
show_language() {
  local lang="$1"
  
  # 先查预定义
  if [[ -n "${PREDEFINED_LANGUAGES[$lang]}" ]]; then
    echo "${PREDEFINED_LANGUAGES[$lang]}" | jq .
    return 0
  fi
  
  # 再查用户注册
  init_config
  if jq -e --arg lang "$lang" '.[$lang]' "$LANGUAGES_FILE" > /dev/null 2>&1; then
    jq --arg lang "$lang" '.[$lang]' "$LANGUAGES_FILE"
    return 0
  fi
  
  log_error "语言未注册: $lang"
  return 1
}

# 注册语言
register_language() {
  local lang="$1"
  local extensions="$2"
  local config="$3"
  
  init_config
  
  # 检查是否是预定义语言
  if [[ -n "${PREDEFINED_LANGUAGES[$lang]}" ]]; then
    log_info "使用预定义配置: $lang"
    
    # 如果指定了自定义扩展名，覆盖默认值
    if [[ -n "$extensions" ]]; then
      local ext_array=$(echo "$extensions" | tr ',' '\n' | jq -R . | jq -s .)
      PREDEFINED_LANGUAGES[$lang]=$(echo "${PREDEFINED_LANGUAGES[$lang]}" | jq --argjson ext "$ext_array" '.extensions = $ext')
    fi
    
    # 如果指定了自定义配置，合并
    if [[ -n "$config" ]]; then
      PREDEFINED_LANGUAGES[$lang]=$(echo "${PREDEFINED_LANGUAGES[$lang]}" | jq --argjson custom "$config" '. * $custom')
    fi
    
    local final_config="${PREDEFINED_LANGUAGES[$lang]}"
  else
    # 新语言，需要完整配置
    if [[ -z "$extensions" ]]; then
      log_error "新语言需要指定文件扩展名"
      echo "示例: $0 $lang \".$lang\""
      exit 1
    fi
    
    local ext_array=$(echo "$extensions" | tr ',' '\n' | jq -R . | jq -s .)
    
    # 创建基础配置
    local base_config=$(cat << EOF
{
  "name": "$lang",
  "extensions": $ext_array,
  "features": ["functions", "classes", "imports"],
  "function_patterns": [],
  "class_patterns": [],
  "import_patterns": [],
  "tree_sitter_grammar": null
}
EOF
)
    
    # 如果指定了自定义配置，合并
    if [[ -n "$config" ]]; then
      final_config=$(echo "$base_config" | jq --argjson custom "$config" '. * $custom')
    else
      final_config="$base_config"
    fi
  fi
  
  # 保存到配置文件
  jq --arg lang "$lang" --argjson config "$final_config" '.[$lang] = $config' "$LANGUAGES_FILE" > "${LANGUAGES_FILE}.tmp"
  mv "${LANGUAGES_FILE}.tmp" "$LANGUAGES_FILE"
  
  log_info "已注册语言: $lang"
  
  # 输出结果
  echo "$final_config" | jq '{
    registered: true,
    language_config: .,
    supported_features: .features
  }'
}

# 主流程
case "$1" in
  -h|--help)
    show_help
    ;;
  --list)
    list_languages
    ;;
  --show)
    show_language "$2"
    ;;
  *)
    if [[ -z "$LANGUAGE" ]]; then
      show_help
    fi
    register_language "$LANGUAGE" "$EXTENSIONS" "$PARSER_CONFIG"
    ;;
esac
