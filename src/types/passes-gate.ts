/**
 * 测试门控类型定义
 */

/**
 * 测试门控配置
 */
export interface PassesGateConfig {
  /** 是否启用 */
  enabled?: boolean;
  
  /** 测试命令 */
  testCommand?: string;
  
  /** 是否需要证据 */
  requireEvidence?: boolean;
  
  /**
   * 是否允许部分通过：退出码为 0 时，输出里的失败信号不再否决判定。
   * 不赦免非零退出码（判定依据收在 core/validators/test-output.ts 的 judgeTestRun，ADR-0014）
   */
  allowPartialPass?: boolean;
  
  /** 最大重试次数 */
  maxRetries?: number;
  
  /** 重试延迟（毫秒） */
  retryDelay?: number;
}

/**
 * 测试结果
 */
export interface TaskTestResult {
  /** 是否通过 */
  passed: boolean;
  
  /** 测试命令 */
  command: string;
  
  /** 输出 */
  output?: string;
  
  /** 错误 */
  error?: string;
  
  /** 执行时间（毫秒） */
  duration?: number;
  
  /** 时间戳 */
  timestamp?: Date;
  
  /** 失败的测试列表 */
  failures?: string[];
  
  /** 证据路径 */
  evidence?: string;
}

/**
 * 测试门控结果
 */
export interface PassesGateResult {
  /** 任务 ID */
  taskId: string;
  
  /** 是否允许设置 */
  allowed: boolean;
  
  /** 测试结果 */
  testResult?: TaskTestResult;
  
  /** 尝试次数 */
  attempts: number;
  
  /** 错误信息 */
  error?: string;
}

/**
 * 动态任务（用于 passes-gate）
 */
export interface DynamicTask {
  /** 任务 ID */
  id: string;
  
  /** 任务名称 */
  name?: string;
  
  /** 是否通过 */
  passes?: boolean;
  
  /** 测试结果 */
  testResult?: TaskTestResult;
}

/**
 * PassesGate 扩展接口
 * 
 * 用于注册额外的测试类型（如 Puppeteer E2E）
 */
export interface PassesGateExtension {
  /** 扩展名称 */
  name: string;
  
  /** 扩展描述 */
  description?: string;
  
  /** 运行测试 */
  run(workDir: string, task?: DynamicTask): Promise<TaskTestResult>;
}

/**
 * 扩展测试结果（包含类型标识）
 */
export interface ExtensionTestResult extends TaskTestResult {
  /** 测试类型（扩展名称） */
  type?: string;
}

// ========================================
// AS-006: 纯约束验证接口
// ========================================

/**
 * 测试结果输入（用于 check() 方法）
 * 
 * 业务层运行测试后传入，harness 只验证结果
 */
export interface TestResult {
  /** 是否通过（必填） */
  passed: boolean;

  /** 测试命令（可选，用于记录） */
  command?: string;

  /** 覆盖率（调用方自备数据，check() 不读它、只随 testResult 原样回显；harness 不取数不执法，ADR-0015） */
  coverage?: number;

  /** 证据路径（可选） */
  evidence?: string;

  /** 失败列表（可选） */
  failures?: string[];

  /** 测试输出（可选） */
  output?: string;

  /** 错误信息（可选） */
  error?: string;

  /** 执行时间（可选） */
  duration?: number;
}

/**
 * PassesGate 验证违规
 */
export interface PassesGateViolation {
  /** Iron Law ID */
  id: string;

  /** Iron Law 规则 */
  rule: string;

  /** 中文消息 */
  message: string;

  /** 约束层级 */
  level: 'iron_law';
}

/**
 * PassesGate check() 结果
 */
export interface PassesGateCheckResult {
  /** 是否允许标记完成 */
  allowed: boolean;

  /** Iron Law 违规列表 */
  violations?: PassesGateViolation[];

  /** 原始测试结果 */
  testResult?: TestResult;
}