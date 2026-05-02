/**
 * 治理类型定义
 *
 * harness 检测差异，LLM 自行决定如何修复
 * 不需要 hook 返回内容、不需要 apply 机制
 */

/**
 * 差异类型
 */
export type DiffType =
  | 'doc_mismatch'       // 文档内容与代码不一致
  | 'context_missing'    // 缺少 CONTEXT.md
  | 'context_outdated'   // CONTEXT.md 内容过时
  | 'test_gap'           // 新代码缺少测试
  | 'constraint_violation' // 约束违规
  | 'changelog_missing'; // 变更未记录到 CHANGELOG

/**
 * 治理检查结果（harness 检测到的差异）
 */
export interface GovernanceDiff {
  /** 差异类型 */
  type: DiffType;
  /** 项目路径 */
  projectPath: string;
  /** 差异详情 */
  details: {
    /** 目标文件 */
    file?: string;
    /** 现有内容 */
    current?: string;
    /** 期望内容（代码实际情况） */
    expected?: string;
    /** 相关文件列表 */
    files?: string[];
    /** 模块名 */
    moduleName?: string;
    /** 约束 ID */
    constraintId?: string;
    /** 额外上下文 */
    context?: Record<string, unknown>;
  };
}

/**
 * 治理执行结果
 */
export interface GovernanceResult {
  /** 是否有差异 */
  hasDiffs: boolean;
  /** 检测到的差异 */
  diffs: GovernanceDiff[];
}
