/**
 * Execution Trace 类型定义
 *
 * 轻量设计：只记录核心信息，零 Token 成本
 */

/**
 * 默认 trace 文件路径（项目相对片段——**不是**可直接打开的路径）
 *
 * 读写双方都必须把它锚到项目根（`path.resolve(projectPath, DEFAULT_TRACE_FILE)`，
 * harness#139）。采集器侧的锚定在 `TraceCollector` 构造内完成（传 `projectPath` 即可）；
 * 需要自定义路径时使用 `TraceCollectorConfig.traceFile`（相对值同样按 projectPath 解析）。
 */
export const DEFAULT_TRACE_FILE = '.harness/logs/traces.log';

/**
 * 约束执行 Trace
 *
 * 设计原则：
 * - 只记录核心字段（零 Token）
 * - 不记录代码片段（需要时从 git diff 获取）
 * - 不记录决策路径（需要时从 execution logs 获取）
 * - 例外（harness#119）：判定证据允许记录——路径级依据不是代码片段，
 *   而没有它，一条恒红的约束在统计侧根本无法回答「红在哪」
 */
export interface ExecutionTrace {
  // ========================================
  // 核心字段（必须）
  // ========================================

  /** 约束 ID */
  constraintId: string;

  /** 约束严重性（ADR-0029：显式 severity 取代三层 level 命名） */
  severity: 'error' | 'warning' | 'info';

  /** 检查时间（Unix timestamp） */
  timestamp: number;

  /** 检查结果（skip = 约定未采用/证据未接线，未评估；不计 pass/fail 分母） */
  result: 'pass' | 'fail' | 'skip';

  // ========================================
  // 轻量上下文（可选）
  // ========================================

  /** 操作类型（触发条件） */
  operation?: string;

  /** 项目路径（用于区分多项目） */
  projectPath?: string;

  /** 会话 ID（用于追踪同一会话的多次检查） */
  sessionId?: string;

  /**
   * 判定证据行（harness#119）
   *
   * 只落 checker 给出的路径级依据（如未登记文件清单），由 checker 截断条数；
   * 不落 pass 结果的空数组，避免无信息记录膨胀 JSONL。
   */
  evidence?: string[];

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

  /** 约束严重性 */
  severity: 'error' | 'warning' | 'info';

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

  /** 跳过次数（ADR-0001：约定未采用/证据未接线；不计入 pass/fail 率分母） */
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

  // ========================================
  // 趋势分析
  // ========================================

  /** 最近趋势 */
  recentTrend: 'stable' | 'rising' | 'falling';

  /** 对比上一周期的变化 */
  changeFromLastPeriod?: {
    passRateDelta: number;
    failRateDelta: number;
  };
}

/**
 * 异常检测结果
 */
export interface TraceAnomaly {
  /** 异常类型 */
  type:
    | 'rising_fail_rate'      // 失败率上升
    | 'low_pass_rate';        // 通过率过低

  /** 约束 ID */
  constraintId: string;

  /** 约束严重性 */
  severity: 'error' | 'warning' | 'info';

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
  suggestedAction?: 'diagnose' | 'adjust_threshold' | 'notify_user';
}

/**
 * Trace 过滤条件
 */
export interface TraceFilter {
  /** 约束 ID（可选，不指定则查全部） */
  constraintId?: string;

  /** 约束严重性（可选） */
  severity?: 'error' | 'warning' | 'info';

  /** 结果类型（可选） */
  result?: 'pass' | 'fail' | 'skip';

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
  /**
   * 项目根（harness#139，#95 约定的落地形状）
   *
   * 给了 → 缺省/相对的 `traceFile` 按它解析（`path.resolve(projectPath, traceFile)`），
   * 从别处带 `--project-path` 跑时 trace 落进目标项目；
   * 不给 → 保持 cwd 解析现状（跨仓消费者的兼容面，不是遗漏）。
   */
  projectPath?: string;

  /** Trace 文件路径（绝对值原样；相对值按 projectPath 解析，无 projectPath 时按 cwd） */
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
    failRate?: number;       // 失败率阈值，默认 0.5
  };
}