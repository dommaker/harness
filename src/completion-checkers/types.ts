/**
 * Completion Checkers 类型定义
 *
 * 三个纯判定函数共享的输入/输出/配置类型。
 * 与 ConstraintCheck 闭环注册表无关：直接 export，不注册、不碰 checkers/index.ts。
 * 函数不碰文件系统与 git，commits 由调用方（git log）供给。
 */

/** 提交集内的单个提交输入（有序，base..HEAD 升序） */
export interface CommitInput {
  /** 完整 sha */
  sha: string;
  /** commit subject（第一行） */
  subject: string;
  /** commit body（trailer 所在） */
  body: string;
  /** 本 commit 触碰的文件清单（相对路径） */
  files: string[];
  /**
   * 是否 merge commit。调用方有 git 数据时应显式供给（如 %P 父数 > 1）；
   * 缺省时按 subject 启发式判定（`/^Merge\s/`）。
   */
  isMerge?: boolean;
}

/** 判定结论：pass / violation / waiver（豁免放行，记台账）/ skip（不适用，不记台账） */
export type CheckerVerdict = 'pass' | 'violation' | 'waiver' | 'skip';

/** 单 commit 判定明细 */
export interface CommitVerdict {
  sha: string;
  verdict: CheckerVerdict;
  reason?: string;
}

/** verifyTddChain 结果。整体 verdict 只取 pass/violation/skip；waiver 是 commit 级结论 */
export interface TddChainResult {
  checker: 'tdd-chain';
  verdict: 'pass' | 'violation' | 'skip';
  commits: CommitVerdict[];
}

/** verifyPhaseFormat 结果 */
export interface PhaseFormatResult {
  checker: 'phase-format';
  verdict: 'pass' | 'violation' | 'skip';
  commits: CommitVerdict[];
}

/** verifyContractPresence 上下文（类型→字段的判定方法映射是代码不是配置） */
export interface ContractPresenceContext {
  /** review 类型契约：调用方已解析的 metadata.reviewReport */
  reviewReport?: unknown;
  [key: string]: unknown;
}

/** verifyContractPresence 结果 */
export interface ContractPresenceResult {
  checker: 'contract-presence';
  verdict: 'pass' | 'violation' | 'skip';
  detail?: string;
}

/**
 * completion_checkers 配置（对应 yml 顶层键 `completion_checkers:`，消费方自解）。
 * 只配开关/glob/契约类型清单；协议格式（Tested-By、Tests: none、phase 结构）写死为机制本体。
 * 缺省 = 全开 + 默认 glob。
 */
export interface CompletionCheckersConfig {
  /** 总开关，缺省 true */
  enabled?: boolean;
  /** 各 checker 开关，缺省全开 */
  checkers?: {
    tddChain?: boolean;
    phaseFormat?: boolean;
    contractPresence?: boolean;
  };
  /** 测试文件 glob，缺省 DEFAULT_TEST_GLOBS */
  testGlobs?: string[];
  /** 非代码文件 glob，缺省 DEFAULT_NONCODE_GLOBS */
  noncodeGlobs?: string[];
  /** 契约类型清单：类型在清单内才判定，无表项 = skip */
  contracts?: string[];
}
