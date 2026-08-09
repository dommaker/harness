/**
 * Execution Trace 类型定义
 *
 * 轻量设计：只记录核心信息，零 Token 成本
 */

/**
 * 默认 trace 文件路径（相对项目根目录）
 *
 * 读写双方必须统一引用此常量；
 * 需要自定义路径时使用 configureTraceCollector / TraceCollectorConfig.traceFile
 */
export const DEFAULT_TRACE_FILE = '.harness/logs/traces.log';

/**
 * 约束执行 Trace
 *
 * 设计原则：
 * - 只记录核心字段（零 Token）
 * - 不记录代码片段（需要时从 git diff 获取）
 * - 不记录决策路径（需要时从 execution logs 获取）
 */
export interface ExecutionTrace {
  // ========================================
  // 核心字段（必须）
  // ========================================

  /** 约束 ID */
  constraintId: string;

  /** 约束层级 */
  level: 'iron_law' | 'guideline' | 'prompt' | 'tip';

  /** 检查时间（Unix timestamp） */
  timestamp: number;

  /** 检查结果（skip = 约定未采用/证据未接线，未评估；不计 pass/fail 分母） */
  result: 'pass' | 'fail' | 'bypassed' | 'skip';

  // ========================================
  // 轻量上下文（可选）
  // ========================================

  /** 操作类型（触发条件） */
  operation?: string;

  /** 严重性（从约束定义继承） */
  severity?: 'error' | 'warning' | 'info';

  /** 例外类型（如果适用了例外） */
  exceptionApplied?: string;

  /** 项目路径（用于区分多项目） */
  projectPath?: string;

  /** 会话 ID（用于追踪同一会话的多次检查） */
  sessionId?: string;

  // ========================================
  // 用户响应（可选，用于诊断）
  // ========================================

  /** 用户如何响应失败 */
  userAction?: 'bypass' | 'fix' | 'ignore' | 'request_help';

  /** 用户绕过理由（如果用户绕过） */
  bypassReason?: string;
}

/**
 * Trace 统计汇总
 *
 * 纯计算结果，零 Token 成本
 */
export interface TraceSummary {
  /** 约束 ID */
  constraintId: string;

  /** 约束层级 */
  level: 'iron_law' | 'guideline' | 'prompt' | 'tip';

  /** 统计时间范围 */
  timeRange: {
    start: number;
    end: number;
  };

  // ========================================
  // 核心统计
  // ========================================

  /** 总检查次数 */
  totalChecks: number;

  /** 通过次数 */
  passCount: number;

  /** 失败次数 */
  failCount: number;

  /** 绕过次数 */
  bypassCount: number;

  /** 跳过次数（ADR-0001：约定未采用/证据未接线；不计入 pass/fail/bypass 率分母） */
  skipCount?: number;

  /** 用户忽略次数 */
  ignoreCount: number;

  // ========================================
  // 比率统计
  // ========================================

  /** 通过率 (0-1) */
  passRate: number;

  /** 失败率 (0-1) */
  failRate: number;

  /** 绕过率 (0-1) */
  bypassRate: number;

  // ========================================
  // 趋势分析
  // ========================================

  /** 最近趋势 */
  recentTrend: 'stable' | 'rising' | 'falling';

  /** 对比上一周期的变化 */
  changeFromLastPeriod?: {
    passRateDelta: number;
    failRateDelta: number;
    bypassRateDelta: number;
  };

  // ========================================
  // 例外统计
  // ========================================

  /** 例外应用次数 */
  exceptionCount: number;

  /** 最常见例外 */
  mostCommonException?: string;
}

/**
 * 异常检测结果
 */
export interface TraceAnomaly {
  /** 异常类型 */
  type:
    | 'high_bypass_rate'      // 绕过率过高
    | 'rising_fail_rate'      // 失败率上升
    | 'rising_bypass_rate'    // 绕过率上升
    | 'low_pass_rate'         // 通过率过低
    | 'exception_overuse';    // 例外滥用

  /** 约束 ID */
  constraintId: string;

  /** 约束层级 */
  level: 'iron_law' | 'guideline' | 'prompt' | 'tip';

  /** 异常描述 */
  message: string;

  /** 相关数据 */
  data: {
    currentRate: number;
    threshold: number;
    trend?: 'rising' | 'falling' | 'stable';
  };

  /** 检测时间 */
  detectedAt: number;

  /** 建议的下一步 */
  suggestedAction?: 'diagnose' | 'adjust_threshold' | 'add_exception' | 'notify_user';
}

/**
 * Trace 过滤条件
 */
export interface TraceFilter {
  /** 约束 ID（可选，不指定则查全部） */
  constraintId?: string;

  /** 约束层级（可选） */
  level?: 'iron_law' | 'guideline' | 'prompt' | 'tip';

  /** 结果类型（可选） */
  result?: 'pass' | 'fail' | 'bypassed' | 'skip';

  /** 时间范围（可选） */
  timeRange?: {
    start: number;
    end: number;
  };

  /** 项目路径（可选） */
  projectPath?: string;

  /** 会话 ID（可选） */
  sessionId?: string;
}

/**
 * Trace 收集器配置
 */
export interface TraceCollectorConfig {
  /** Trace 文件路径 */
  traceFile?: string;

  /** 最大文件大小（字节），超出则滚动 */
  maxFileSize?: number;

  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/**
 * 分析器配置
 */
export interface TraceAnalyzerConfig {
  /** Summary 文件路径 */
  summaryFile?: string;

  /** 周期长度（毫秒），默认 1 小时 */
  periodMs?: number;

  /** 异常阈值 */
  thresholds?: {
    bypassRate?: number;     // 绕过率阈值，默认 0.3
    failRate?: number;       // 失败率阈值，默认 0.5
    exceptionRate?: number;  // 例外率阈值，默认 0.4
  };
}