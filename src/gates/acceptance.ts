/**
 * 验收标准门禁
 *
 * 功能：
 * 1. 验证任务是否满足验收标准
 * 2. 解析 tasks.yml 中的验收条件（只认新契约 `acceptance`；旧的逐条勾选
 *    格式已随 gates 层现代化删除，不再兼容）
 * 3. 运行关联的 E2E 测试
 *
 * 验收条件判定（唯一契约）：`checked: true` → 满足；未勾选且带 `e2e_test`
 * → 跑 E2E 按测试结论判定；未勾选且无 `e2e_test` → 不满足（判负，不静默放过）。
 *
 * fail-fast：tasks.yml 解析失败 / 形状非法直接抛错（CLI 侧由 reportGateError
 * 收口为命令失败），不存在「解析失败当通过/当跳过」的兜底分支。
 *
 * 使用示例：
 * ```typescript
 * const gate = new SpecAcceptanceGate();
 * const result = await gate.check({
 *   projectPath: '/path/to/project',
 *   taskId: 'TASK-001',
 * });
 * ```
 */

import { execAsync } from '../utils/exec';
import { isRecord } from '../utils/guards';
import { judgeTestRun } from '../core/validators/test-output';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  Gate,
  GateContext,
  GateDecision,
  SpecAcceptanceGateConfig,
  AcceptanceGateContext,
} from './types';
import { gateResult } from './types';
import { decisionFromResult } from './decision';


// ==================== 类型定义 ====================
// SpecAcceptanceGateConfig / AcceptanceGateContext 正本在 ./types
// （harness#101：本文件不再持有双份定义与工厂）

/**
 * 验收条件（唯一契约，支持 E2E 测试关联）
 */
export interface AcceptanceCondition {
  description: string;
  e2e_test?: string;
  test_name?: string;
  checked?: boolean;
}

/**
 * 任务定义
 */
export interface TaskDefinition {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  /** 验收条件（支持 E2E 测试） */
  acceptance?: AcceptanceCondition[];
  status?: string;
  completed?: boolean;
}

/**
 * Tasks 文件结构
 */
export interface TasksFile {
  tasks: TaskDefinition[];
  version?: string;
}

/**
 * 验收门禁结果 details 负载（type alias 而非 interface：
 * 需要隐式索引签名以直接赋给 GateResult.details 的 Record 形状）
 *
 * totalCriteria/checkedCriteria/uncheckedCriteria 一律按**验收条件**计数
 * （聚合路径逐任务累加，不填任务数）。
 */
export type AcceptanceGateDetails = {
  taskId?: string;
  totalCriteria: number;
  checkedCriteria: number;
  uncheckedCriteria: string[];
  e2eTestResults?: E2ETestResult[];
};

/**
 * 验收门禁结果
 */
export interface AcceptanceGateResult {
  passed: boolean;
  message: string;
  timestamp: string;
  details?: AcceptanceGateDetails;
}

/**
 * E2E 测试结果
 */
export interface E2ETestResult {
  criteria: string;
  testFile: string;
  testName?: string;
  passed: boolean;
  output?: string;
  error?: string;
}

// ==================== tasks.yml 解析与校验 ====================

/**
 * yaml.load 结果 → TasksFile：形状非法即抛错（fail-fast，不静默兜底）。
 * 校验只到判定实际读取的字段：tasks 数组、任务 id、acceptance 条目的
 * description / e2e_test / test_name / checked。
 */
export function parseTasksFile(raw: unknown, tasksPath: string): TasksFile {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) {
    throw new Error(`tasks.yml 格式非法（缺 tasks 数组）: ${tasksPath}`);
  }

  const tasks: TaskDefinition[] = raw.tasks.map((entry: unknown, index: number) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`tasks.yml 格式非法（tasks[${index}] 缺 id）: ${tasksPath}`);
    }

    let acceptance: AcceptanceCondition[] | undefined;
    if (entry.acceptance !== undefined) {
      if (!Array.isArray(entry.acceptance)) {
        throw new Error(`tasks.yml 格式非法（任务 ${entry.id} 的 acceptance 不是数组）: ${tasksPath}`);
      }
      acceptance = entry.acceptance.map((c: unknown, ci: number) => {
        if (!isRecord(c) || typeof c.description !== 'string') {
          throw new Error(
            `tasks.yml 格式非法（任务 ${entry.id} 的 acceptance[${ci}] 缺 description）: ${tasksPath}`
          );
        }
        for (const key of ['e2e_test', 'test_name'] as const) {
          if (c[key] !== undefined && typeof c[key] !== 'string') {
            throw new Error(
              `tasks.yml 格式非法（任务 ${entry.id} 的 acceptance[${ci}].${key} 不是字符串）: ${tasksPath}`
            );
          }
        }
        if (c.checked !== undefined && typeof c.checked !== 'boolean') {
          throw new Error(
            `tasks.yml 格式非法（任务 ${entry.id} 的 acceptance[${ci}].checked 不是布尔）: ${tasksPath}`
          );
        }
        return {
          description: c.description,
          e2e_test: c.e2e_test as string | undefined,
          test_name: c.test_name as string | undefined,
          checked: c.checked as boolean | undefined,
        };
      });
    }

    return {
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title : undefined,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      acceptance,
      status: typeof entry.status === 'string' ? entry.status : undefined,
      completed: typeof entry.completed === 'boolean' ? entry.completed : undefined,
    };
  });

  return {
    tasks,
    version: typeof raw.version === 'string' ? raw.version : undefined,
  };
}

// ==================== SpecAcceptanceGate 类 ====================

/**
 * 验收标准门禁
 */
export class SpecAcceptanceGate implements Gate {
  readonly id = 'acceptance';
  order = 0;
  private config: SpecAcceptanceGateConfig;

  constructor(config?: Partial<SpecAcceptanceGateConfig>) {
    this.config = {
      checkAllTasks: false,
      e2eTestCommand: 'npx playwright test',
      e2eTestTimeout: 120000,
      ...config,
    };
  }

  /**
   * 统一门禁接口（G1）：执行细节私有，决策三态由 check() 报告推导。
   * AcceptanceGateResult 无 gate 字段，此处经 gateResult 构造器归一化为 GateResult
   * 报告结构（本层约定不手拼 GateResult 字面量）。
   */
  async evaluate(context: GateContext): Promise<GateDecision> {
    const startedAt = Date.now();
    const result = await this.check({
      projectPath: context.projectPath,
      taskId: context.taskId,
      tasksPath: context.tasksPath,
    });
    return decisionFromResult(
      gateResult('acceptance', result.passed, result.message, startedAt, result.details)
    );
  }

  /**
   * 检查验收标准（fail-fast：解析/校验失败直接抛出，不拼错误报告）
   */
  async check(context: AcceptanceGateContext): Promise<AcceptanceGateResult> {
    // 确定 tasks.yml 路径：相对值一律锚在 projectPath（此处不取 cwd）
    const tasksPath = path.resolve(
      context.projectPath,
      context.tasksPath ?? this.config.tasksPath ?? 'tasks.yml',
    );

    // 加载 tasks 文件
    const tasks = await this.loadTasks(tasksPath);

    if (!tasks || tasks.tasks.length === 0) {
      return {
        passed: true,
        message: 'No tasks.yml found or no tasks defined, skipping',
        timestamp: new Date().toISOString(),
      };
    }

    // 检查特定任务或所有任务
    if (context.taskId) {
      return this.checkSingleTask(tasks, context.taskId, context.projectPath);
    } else if (this.config.checkAllTasks) {
      return this.checkAllTasks(tasks, context.projectPath);
    } else {
      // 默认只检查已完成任务
      return this.checkCompletedTasks(tasks, context.projectPath);
    }
  }

  /**
   * 加载 tasks.yml：ENOENT → null（「无 tasks.yml 即跳过」是门禁语义，不是兜底）；
   * 其余读取/解析/校验失败一律抛出。
   */
  private async loadTasks(tasksPath: string): Promise<TasksFile | null> {
    let content: string;
    try {
      content = await fs.readFile(tasksPath, 'utf-8');
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    return parseTasksFile(yaml.load(content), tasksPath);
  }

  /**
   * 检查单个任务
   */
  private async checkSingleTask(
    tasks: TasksFile,
    taskId: string,
    projectPath: string
  ): Promise<AcceptanceGateResult> {
    const task = tasks.tasks.find(t => t.id === taskId);

    if (!task) {
      return {
        passed: false,
        message: `Task not found: ${taskId}`,
        timestamp: new Date().toISOString(),
      };
    }

    return this.validateTask(task, projectPath);
  }

  /** 聚合 details：按验收条件计数（逐任务累加），未满足项带任务 id 前缀 */
  private aggregateDetails(results: AcceptanceGateResult[]): AcceptanceGateDetails {
    let totalCriteria = 0;
    const unchecked: string[] = [];
    for (const r of results) {
      totalCriteria += r.details?.totalCriteria ?? 0;
      for (const c of r.details?.uncheckedCriteria ?? []) {
        unchecked.push(`${r.details?.taskId}: ${c}`);
      }
    }
    return {
      totalCriteria,
      checkedCriteria: totalCriteria - unchecked.length,
      uncheckedCriteria: unchecked,
    };
  }

  /**
   * 检查所有任务
   */
  private async checkAllTasks(
    tasks: TasksFile,
    projectPath: string
  ): Promise<AcceptanceGateResult> {
    const results: AcceptanceGateResult[] = [];

    for (const task of tasks.tasks) {
      results.push(await this.validateTask(task, projectPath));
    }

    const failedTasks = results.filter(r => !r.passed);

    if (failedTasks.length === 0) {
      return {
        passed: true,
        message: 'All tasks pass acceptance criteria',
        timestamp: new Date().toISOString(),
        details: this.aggregateDetails(results),
      };
    }

    return {
      passed: false,
      message: `${failedTasks.length} task(s) fail acceptance criteria`,
      timestamp: new Date().toISOString(),
      details: this.aggregateDetails(results),
    };
  }

  /**
   * 检查已完成的任务
   */
  private async checkCompletedTasks(
    tasks: TasksFile,
    projectPath: string
  ): Promise<AcceptanceGateResult> {
    const completedTasks = tasks.tasks.filter(t => t.completed || t.status === 'done');

    if (completedTasks.length === 0) {
      return {
        passed: true,
        message: 'No completed tasks to check',
        timestamp: new Date().toISOString(),
      };
    }

    const results: AcceptanceGateResult[] = [];
    for (const task of completedTasks) {
      results.push(await this.validateTask(task, projectPath));
    }

    const failedTasks = results.filter(r => !r.passed);

    if (failedTasks.length === 0) {
      return {
        passed: true,
        message: 'All completed tasks pass acceptance criteria',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      passed: false,
      message: `${failedTasks.length} completed task(s) fail acceptance criteria`,
      timestamp: new Date().toISOString(),
      details: this.aggregateDetails(results),
    };
  }

  /**
   * 验证任务
   */
  private async validateTask(
    task: TaskDefinition,
    projectPath: string
  ): Promise<AcceptanceGateResult> {
    const conditions = task.acceptance ?? [];

    if (conditions.length === 0) {
      return {
        passed: true,
        message: `Task ${task.id} has no acceptance criteria`,
        timestamp: new Date().toISOString(),
      };
    }

    const e2eResults: E2ETestResult[] = [];
    const unchecked: string[] = [];

    for (const condition of conditions) {
      if (condition.checked) {
        continue;
      }
      // 未勾选且关联 E2E 测试 → 跑测试按结论判定；未勾选且无测试 → 不满足
      if (condition.e2e_test) {
        const result = await this.runE2ETest(
          projectPath,
          condition.e2e_test,
          condition.test_name
        );
        e2eResults.push(result);
        if (!result.passed) {
          unchecked.push(condition.description);
        }
      } else {
        unchecked.push(condition.description);
      }
    }

    const details: AcceptanceGateDetails = {
      taskId: task.id,
      totalCriteria: conditions.length,
      checkedCriteria: conditions.length - unchecked.length,
      uncheckedCriteria: unchecked,
      ...(e2eResults.length > 0 ? { e2eTestResults: e2eResults } : {}),
    };

    if (unchecked.length === 0) {
      return {
        passed: true,
        message: `Task ${task.id} passes all acceptance criteria`,
        timestamp: new Date().toISOString(),
        details,
      };
    }

    return {
      passed: false,
      message: `Task ${task.id} has ${unchecked.length} unchecked acceptance criteria`,
      timestamp: new Date().toISOString(),
      details,
    };
  }

  /**
   * 运行 E2E 测试
   *
   * 退出码非零 / 超时 = 测试判负（报告层 fail，不是门禁异常）；
   * 文本只能否决不能反向加分（与 passes-gate 同一判定入口，ADR-0014）。
   */
  private async runE2ETest(
    projectPath: string,
    testFile: string,
    testName?: string
  ): Promise<E2ETestResult> {
    const timeout = this.config.e2eTestTimeout ?? 120000;

    // 构建测试命令
    let command = this.config.e2eTestCommand ?? 'npx playwright test';
    command += ` ${testFile}`;

    if (testName) {
      command += ` -g "${testName}"`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: projectPath,
        timeout,
      });

      const output = stdout + stderr;
      // 退出码为 0 的分支：文本只能否决，不能反向加分（ADR-0014）
      const { passed } = judgeTestRun({ exitCode: 0, output });

      return {
        criteria: testFile,
        testFile,
        testName,
        passed,
        output: output.substring(0, 2000),
      };
    } catch (error: unknown) {
      // 超时或非零退出的分支：判负，文本不参与（文本救不回非零退出，ADR-0014）
      const message = error instanceof Error ? error.message : String(error);
      const stdout = isRecord(error) && typeof error.stdout === 'string' ? error.stdout : undefined;
      return {
        criteria: testFile,
        testFile,
        testName,
        passed: false,
        error: message,
        output: stdout?.substring(0, 2000) ?? message,
      };
    }
  }
}
