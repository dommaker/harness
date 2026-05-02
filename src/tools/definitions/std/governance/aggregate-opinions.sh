#!/bin/bash
# aggregate-opinions.sh - 汇聚意见工具
# ============================================================================
# 功能：汇聚多个立场的审核意见，统计结果
# 用途：wf-review 多立场审核，为决策者提供参考
# ============================================================================

set -e

# 参数
ARTIFACT_TYPE="${1:-}"
OPINIONS_FILE="${2:-}"
AGGREGATION_METHOD="${3:-weighted}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 显示帮助
show_help() {
  cat << EOF
汇聚意见工具

用法:
  $0 <artifact_type> <opinions_file> [aggregation_method]

参数:
  artifact_type       审核对象类型 (proposal/architecture/code/decision)
  opinions_file       意见文件路径（JSON 格式）
  aggregation_method  汇聚方法 (weighted/majority/unanimous，默认 weighted)

汇聚方法:
  weighted   加权汇聚（根据立场权重计算）
  majority   多数决（超过半数即为通过）
  unanimous  全票通过（所有人都同意才通过）

输入格式 (opinions.json):
  [
    {
      "stance_id": "critic",
      "verdict": "reject",
      "opinion": "存在安全风险",
      "issues": [...]
    },
    {
      "stance_id": "supporter",
      "verdict": "approve",
      "opinion": "方案可行",
      "issues": []
    }
  ]

输出:
  JSON 格式的汇聚结果和统计信息

示例:
  $0 proposal opinions.json weighted
  $0 architecture opinions.json majority
EOF
  exit 0
}

# 检查参数
if [[ "$1" == "-h" || "$1" == "--help" || -z "$ARTIFACT_TYPE" || -z "$OPINIONS_FILE" ]]; then
  show_help
fi

# 检查文件是否存在
if [[ ! -f "$OPINIONS_FILE" ]]; then
  log_error "意见文件不存在: $OPINIONS_FILE"
  echo '{"success": false, "error": "Opinions file not found"}'
  exit 1
fi

# 读取意见
OPINIONS=$(cat "$OPINIONS_FILE")

# 立场权重
declare -A WEIGHTS
WEIGHTS["critic"]=1.5      # 挑刺者权重高
WEIGHTS["supporter"]=1.0   # 支持者权重正常
WEIGHTS["decider"]=2.0     # 决策者权重最高
WEIGHTS["architect"]=1.3   # 架构师权重较高
WEIGHTS["security"]=1.5    # 安全专家权重高
WEIGHTS["performance"]=1.2 # 性能专家权重较高

# 统计结果
TOTAL_COUNT=$(echo "$OPINIONS" | jq 'length')
APPROVE_COUNT=$(echo "$OPINIONS" | jq '[.[] | select(.verdict == "approve")] | length')
REJECT_COUNT=$(echo "$OPINIONS" | jq '[.[] | select(.verdict == "reject")] | length')
REQUEST_CHANGES_COUNT=$(echo "$OPINIONS" | jq '[.[] | select(.verdict == "request_changes")] | length')

# 提取所有问题
ALL_ISSUES=$(echo "$OPINIONS" | jq '[.[] | .issues // []] | flatten')

# 计算加权分数
WEIGHTED_SCORE=0
TOTAL_WEIGHT=0

while IFS= read -r opinion; do
  STANCE_ID=$(echo "$opinion" | jq -r '.stance_id')
  VERDICT=$(echo "$opinion" | jq -r '.verdict')
  WEIGHT="${WEIGHTS[$STANCE_ID]:-1.0}"
  
  case "$VERDICT" in
    approve)          SCORE=1 ;;
    request_changes)  SCORE=0.5 ;;
    reject)           SCORE=0 ;;
    *)                SCORE=0.5 ;;
  esac
  
  WEIGHTED_SCORE=$(echo "$WEIGHTED_SCORE + $SCORE * $WEIGHT" | bc)
  TOTAL_WEIGHT=$(echo "$TOTAL_WEIGHT + $WEIGHT" | bc)
done < <(echo "$OPINIONS" | jq -c '.[]')

# 计算加权平均
WEIGHTED_AVERAGE=$(echo "scale=2; $WEIGHTED_SCORE / $TOTAL_WEIGHT" | bc)

# 根据汇聚方法确定最终结果
case "$AGGREGATION_METHOD" in
  weighted)
    # 加权平均 >= 0.6 为通过
    if (( $(echo "$WEIGHTED_AVERAGE >= 0.6" | bc -l) )); then
      FINAL_VERDICT="approve"
      CONFIDENCE=$WEIGHTED_AVERAGE
    elif (( $(echo "$WEIGHTED_AVERAGE >= 0.3" | bc -l) )); then
      FINAL_VERDICT="request_changes"
      CONFIDENCE=$WEIGHTED_AVERAGE
    else
      FINAL_VERDICT="reject"
      CONFIDENCE=$(echo "1 - $WEIGHTED_AVERAGE" | bc)
    fi
    ;;
  
  majority)
    # 多数决
    if (( APPROVE_COUNT > TOTAL_COUNT / 2 )); then
      FINAL_VERDICT="approve"
      CONFIDENCE=$(echo "scale=2; $APPROVE_COUNT / $TOTAL_COUNT" | bc)
    elif (( REJECT_COUNT > TOTAL_COUNT / 2 )); then
      FINAL_VERDICT="reject"
      CONFIDENCE=$(echo "scale=2; $REJECT_COUNT / $TOTAL_COUNT" | bc)
    else
      FINAL_VERDICT="request_changes"
      CONFIDENCE=0.5
    fi
    ;;
  
  unanimous)
    # 全票通过
    if (( APPROVE_COUNT == TOTAL_COUNT )); then
      FINAL_VERDICT="approve"
      CONFIDENCE=1.0
    elif (( REJECT_COUNT > 0 )); then
      FINAL_VERDICT="reject"
      CONFIDENCE=$(echo "scale=2; $REJECT_COUNT / $TOTAL_COUNT" | bc)
    else
      FINAL_VERDICT="request_changes"
      CONFIDENCE=0.5
    fi
    ;;
  
  *)
    FINAL_VERDICT="request_changes"
    CONFIDENCE=0.5
    ;;
esac

# 生成摘要
SUMMARY="共 $TOTAL_COUNT 个立场审核："
SUMMARY="$SUMMARY $APPROVE_COUNT 通过，$REJECT_COUNT 拒绝，$REQUEST_CHANGES_COUNT 要求修改。"
SUMMARY="$SUMMARY 最终结果：$FINAL_VERDICT（置信度：$CONFIDENCE）"

# 输出结果
cat << EOF
{
  "success": true,
  "aggregated_result": {
    "verdict": "$FINAL_VERDICT",
    "confidence": $CONFIDENCE,
    "summary": "$SUMMARY",
    "method": "$AGGREGATION_METHOD"
  },
  "statistics": {
    "total_count": $TOTAL_COUNT,
    "approve_count": $APPROVE_COUNT,
    "reject_count": $REJECT_COUNT,
    "request_changes_count": $REQUEST_CHANGES_COUNT,
    "weighted_average": $WEIGHTED_AVERAGE,
    "issues_count": $(echo "$ALL_ISSUES" | jq 'length')
  },
  "issues": $ALL_ISSUES,
  "by_stance": $(echo "$OPINIONS" | jq '[.[] | {stance_id, verdict}]')
}
EOF
