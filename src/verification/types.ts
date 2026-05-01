/**
 * Verification Loop 类型定义
 */

// ── 验证规则 ─────────────────────────────────────────────

/** 验证规则类型 */
export type VerificationRuleType = 'test' | 'lint' | 'typecheck' | 'custom';

/** 验证规则 */
export interface VerificationRule {
  id: string;
  type: VerificationRuleType;
  name: string;
  description: string;
  /** 执行命令（用于 test/lint/typecheck） */
  command?: string;
  /** 自定义验证函数（用于 custom） */
  verify?: (context: VerificationContext) => Promise<VerificationResult>;
  /** 超时（ms） */
  timeout?: number;
}

/** 验证上下文 */
export interface VerificationContext {
  /** 项目根目录 */
  projectRoot: string;
  /** 变更的文件列表 */
  changedFiles?: string[];
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/** 单条规则的验证结果 */
export interface VerificationResult {
  passed: boolean;
  ruleId: string;
  message?: string;
  details?: string;
  duration: number;
}

// ── 验证循环 ─────────────────────────────────────────────

/** 验证循环状态 */
export type LoopStatus = 'idle' | 'gathering' | 'acting' | 'verifying' | 'passed' | 'failed';

/** 验证循环配置 */
export interface VerificationLoopConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 验证规则 */
  rules: VerificationRule[];
  /** 是否在首次失败时立即停止 */
  failFast?: boolean;
}

/** 验证循环快照 */
export interface LoopSnapshot {
  status: LoopStatus;
  attempt: number;
  maxRetries: number;
  results: VerificationResult[];
  lastError?: string;
  timestamp: string;
}

/** Gather 阶段的状态 */
export interface GatherState {
  changedFiles: string[];
  testResults?: string;
  lintResults?: string;
  metadata: Record<string, unknown>;
}

/** Act 阶段的动作 */
export interface ActAction {
  type: 'fix' | 'retry' | 'skip' | 'abort';
  description: string;
  target?: string;
}
