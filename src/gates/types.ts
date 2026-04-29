/**
 * 门禁类型定义
 */

/**
 * 门禁结果
 */
export interface GateResult {
  gate: string;
  passed: boolean;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
  duration?: number;
}

/**
 * 门禁上下文
 */
export interface GateContext {
  projectId: string;
  taskId?: string;
  projectPath: string;
  
  // Review Gate
  prNumber?: number;
  minReviewers?: number;
  reviewers?: string[];
  
  // Security Gate
  securityScanCommand?: string;
  ignoreWarnings?: boolean;
  
  // Performance Gate
  performanceThresholds?: PerformanceThresholds;
  benchmarkCommand?: string;
  
  // Contract Gate
  oldContractPath?: string;
  newContractPath?: string;
  openApiSpec?: string;
  
  // 通用
  timeout?: number;
}

/**
 * 性能阈值
 */
export interface PerformanceThresholds {
  maxResponseTime?: number;   // ms
  maxMemoryUsage?: number;    // MB
  minCoverage?: number;       // %
  maxBundleSize?: number;     // KB
  minThroughput?: number;     // req/s
}

/**
 * 审查门禁配置
 */
export interface ReviewGateConfig {
  minReviewers: number;
  requireApproval: boolean;
  blockOnChangesRequested: boolean;
  allowedReviewers?: string[];
}

/**
 * 安全门禁配置
 */
export interface SecurityGateConfig {
  enabled: boolean;
  scanCommand?: string;
  ignoreWarnings: boolean;
  ignoreDevDependencies: boolean;
  severityThreshold: 'low' | 'moderate' | 'high' | 'critical';
}

/**
 * 性能门禁配置
 */
export interface PerformanceGateConfig {
  enabled: boolean;
  benchmarkCommand?: string;
  thresholds: PerformanceThresholds;
  warmupRuns: number;
  measureRuns: number;
}

/**
 * 契约门禁配置
 */
export interface ContractGateConfig {
  enabled: boolean;
  strict: boolean;
  allowBreakingChanges: boolean;
  contractPath?: string;
}

/**
 * 验收标准门禁配置
 */
export interface SpecAcceptanceGateConfig {
  /** tasks.yml 路径 */
  tasksPath?: string;
  /** 是否检查所有任务 */
  checkAllTasks?: boolean;
  /** 自定义验收条件 */
  customAcceptanceCriteria?: Record<string, (task: any) => Promise<boolean>>;
}

/**
 * 验收标准门禁上下文
 */
export interface AcceptanceGateContext {
  /** 项目路径 */
  projectPath: string;
  /** 任务 ID */
  taskId?: string;
  /** tasks.yml 路径 */
  tasksPath?: string;
}

/**
 * 验收标准
 */
export interface AcceptanceCriteria {
  id: string;
  description: string;
  type: 'manual' | 'automated' | 'test';
  required: boolean;
  checked?: boolean;
  notes?: string;
}

/**
 * 命令黑名单规则
 */
export interface CommandBlacklistRule {
  id: string;
  pattern: RegExp;
  level: 'block' | 'warn' | 'audit';
  message: string;
  category: string;
}

/**
 * 命令门禁配置
 */
export interface CommandGateConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 严格模式（warn 也阻止） */
  strict?: boolean;
  /** 自定义黑名单规则 */
  customBlacklist?: CommandBlacklistRule[];
  /** 忽略的类别 */
  ignoreCategories?: string[];
}
