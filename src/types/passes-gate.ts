/**
 * 测试门控类型定义
 */

/**
 * 验证证据的约定落点（项目根相对路径）
 *
 * 写方 = PassesGate.runTests（真实跑测试命令后落盘）与消费方外部验证事件；
 * 读方 = no_completion_without_verification checker（harness#183）。路径真相只此一处。
 */
export const EVIDENCE_DIR_REL = '.harness/evidence';

/**
 * 测试门控配置
 */
export interface PassesGateConfig {
  /** 是否启用 */
  enabled?: boolean;
  
  /**
   * 测试命令。缺省时走 core/validators/passes-gate.ts 的 detectTestCommand 探测：
   * test:ci → test（排除 echo 占位脚本）→ test:e2e → test:coverage → Python 标记 → go.mod；
   * 探不到则 fail-closed（不再兜底 'npm test'）
   */
  testCommand?: string;
  
  /** 是否需要证据 */
  requireEvidence?: boolean;
  
  /**
   * 是否允许部分通过：退出码为 0 时，输出里的失败信号不再否决判定。
   * 不赦免非零退出码（判定依据收在 core/validators/test-output.ts 的 judgeTestRun，ADR-0014）
   */
  allowPartialPass?: boolean;
}

/**
 * 测试结果（PassesGate.runTests 的产出：harness 真跑测试命令后的运行结果）
 *
 * 与 TestResult 的边界（近同构七字段是刻意不合一，班次 3 Phase 5 划界）：
 * 本类型是 **harness 产出**（runTests 返回值），command 必填（跑过的命令）、
 * 带 timestamp；TestResult 是 **调用方自备输入**（check() 形参，业务层跑完测试
 * 喂给 harness 判定），command 可选、可带 coverage（harness 只回显不取数）。
 * 产出与输入角色不同，字段可选性正是契约差异，合一必破其中一边的公共面。
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

// ========================================
// AS-006: 纯约束验证接口
// ========================================

/**
 * 测试结果输入（用于 check() 方法：调用方自备的运行结果，harness 只验证不再跑）
 * 
 * 业务层运行测试后传入，harness 只验证结果。与 TaskTestResult 的边界见其注释
 * （本类型 = 输入面，command/coverage 可选；TaskTestResult = runTests 产出面）。
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
  /** 约束 ID */
  id: string;

  /** 约束规则 */
  rule: string;

  /** 中文消息 */
  message: string;

  /** 约束严重性（PassesGate 违规恒为阻断级） */
  severity: 'error';
}

/**
 * PassesGate check() 结果
 */
export interface PassesGateCheckResult {
  /** 是否允许标记完成 */
  allowed: boolean;

  /** 阻断级违规列表 */
  violations?: PassesGateViolation[];

  /** 原始测试结果 */
  testResult?: TestResult;
}