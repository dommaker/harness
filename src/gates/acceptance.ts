/**
 * 验收标准门禁
 * 
 * 功能：
 * 1. 验证任务是否满足验收标准
 * 2. 解析 tasks.yml 中的验收条件
 * 3. 检查所有验收条件是否满足
 * 4. 运行关联的 E2E 测试
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
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';


// ==================== 类型定义 ====================

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
  /** E2E 测试命令模板 */
  e2eTestCommand?: string;
  /** E2E 测试超时时间（毫秒） */
  e2eTestTimeout?: number;
  /** 项目路径 */
  projectPath?: string;
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
 * 验收标准（旧格式，向后兼容）
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
 * 验收条件（新格式，支持 E2E 测试关联）
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
  /** 旧格式 */
  acceptance_criteria?: AcceptanceCriteria[];
  /** 新格式（支持 E2E 测试） */
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
 * 验收门禁结果
 */
export interface AcceptanceGateResult {
  passed: boolean;
  message: string;
  timestamp: string;
  details?: {
    taskId?: string;
    totalCriteria: number;
    checkedCriteria: number;
    uncheckedCriteria: string[];
    missingCriteria: string[];
    e2eTestResults?: E2ETestResult[];
  };
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

// ==================== SpecAcceptanceGate 类 ====================

/**
 * 验收标准门禁
 */
export class SpecAcceptanceGate {
  private config: SpecAcceptanceGateConfig;

  constructor(config?: Partial<SpecAcceptanceGateConfig>) {
    this.config = {
      tasksPath: './tasks.yml',
      checkAllTasks: false,
      e2eTestCommand: 'npx playwright test',
      e2eTestTimeout: 120000,
      ...config,
    };
  }

  /**
   * 检查验收标准
   */
  async check(context: AcceptanceGateContext): Promise<AcceptanceGateResult> {
    try {
      // 确定 tasks.yml 路径
      const tasksPath = context.tasksPath ?? 
        this.config.tasksPath ?? 
        path.join(context.projectPath, 'tasks.yml');

      // 加载 tasks 文件
      const tasks = await this.loadTasks(tasksPath);

      if (!tasks || !tasks.tasks || tasks.tasks.length === 0) {
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
    } catch (error: any) {
      return {
        passed: false,
        message: `Acceptance gate error: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 加载 tasks.yml
   */
  private async loadTasks(tasksPath: string): Promise<TasksFile | null> {
    try {
      const content = await fs.readFile(tasksPath, 'utf-8');
      return yaml.load(content) as TasksFile;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
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
        details: {
          totalCriteria: results.length,
          checkedCriteria: results.length,
          uncheckedCriteria: [],
          missingCriteria: [],
        },
      };
    }

    return {
      passed: false,
      message: `${failedTasks.length} task(s) fail acceptance criteria`,
      timestamp: new Date().toISOString(),
      details: {
        totalCriteria: results.length,
        checkedCriteria: results.length - failedTasks.length,
        uncheckedCriteria: failedTasks.map(r => r.message),
        missingCriteria: [],
      },
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
      details: {
        totalCriteria: results.length,
        checkedCriteria: results.length - failedTasks.length,
        uncheckedCriteria: failedTasks.map(r => r.message),
        missingCriteria: [],
      },
    };
  }

  /**
   * 验证任务
   */
  private async validateTask(
    task: TaskDefinition, 
    projectPath: string
  ): Promise<AcceptanceGateResult> {
    const e2eResults: E2ETestResult[] = [];
    
    // 优先使用新格式 acceptance
    if (task.acceptance && task.acceptance.length > 0) {
      for (const criteria of task.acceptance) {
        // 如果有关联的 E2E 测试，运行它
        if (criteria.e2e_test && !criteria.checked) {
          const result = await this.runE2ETest(
            projectPath,
            criteria.e2e_test,
            criteria.test_name
          );
          e2eResults.push(result);
          
          if (!result.passed) {
            return {
              passed: false,
              message: `E2E test failed for "${criteria.description}": ${criteria.e2e_test}`,
              timestamp: new Date().toISOString(),
              details: {
                taskId: task.id,
                totalCriteria: task.acceptance.length,
                checkedCriteria: task.acceptance.filter(c => c.checked).length,
                uncheckedCriteria: [criteria.description],
                missingCriteria: [],
                e2eTestResults: e2eResults,
              },
            };
          }
        }
      }
      
      return {
        passed: true,
        message: `Task ${task.id} passes all acceptance criteria`,
        timestamp: new Date().toISOString(),
        details: {
          taskId: task.id,
          totalCriteria: task.acceptance.length,
          checkedCriteria: task.acceptance.length,
          uncheckedCriteria: [],
          missingCriteria: [],
          e2eTestResults: e2eResults.length > 0 ? e2eResults : undefined,
        },
      };
    }
    
    // 兼容旧格式 acceptance_criteria
    if (!task.acceptance_criteria || task.acceptance_criteria.length === 0) {
      return {
        passed: true,
        message: `Task ${task.id} has no acceptance criteria`,
        timestamp: new Date().toISOString(),
      };
    }

    const unchecked: string[] = [];

    for (const criteria of task.acceptance_criteria) {
      if (criteria.required && !criteria.checked) {
        unchecked.push(criteria.id);
      }
    }

    if (unchecked.length === 0) {
      return {
        passed: true,
        message: `Task ${task.id} passes all acceptance criteria`,
        timestamp: new Date().toISOString(),
        details: {
          taskId: task.id,
          totalCriteria: task.acceptance_criteria.length,
          checkedCriteria: task.acceptance_criteria.filter(c => c.checked).length,
          uncheckedCriteria: [],
          missingCriteria: [],
        },
      };
    }

    return {
      passed: false,
      message: `Task ${task.id} has ${unchecked.length} unchecked acceptance criteria`,
      timestamp: new Date().toISOString(),
      details: {
        taskId: task.id,
        totalCriteria: task.acceptance_criteria.length,
        checkedCriteria: task.acceptance_criteria.filter(c => c.checked).length,
        uncheckedCriteria: unchecked,
        missingCriteria: [],
      },
    };
  }

  /**
   * 运行 E2E 测试
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
      const passed = this.parseTestOutput(output);

      return {
        criteria: testFile,
        testFile,
        testName,
        passed,
        output: output.substring(0, 2000),
      };
    } catch (error: any) {
      // 超时或执行失败
      return {
        criteria: testFile,
        testFile,
        testName,
        passed: false,
        error: error.message,
        output: error.stdout?.substring(0, 2000) ?? error.message,
      };
    }
  }

  /**
   * 解析测试输出判断是否通过
   */
  private parseTestOutput(output: string): boolean {
    // Playwright 格式
    if (output.includes('passed')) {
      // 检查是否有失败
      const failedMatch = output.match(/(\d+)\s+failed/);
      if (failedMatch && parseInt(failedMatch[1]) > 0) {
        return false;
      }
      return true;
    }
    
    // Jest 格式
    if (output.includes('Test Suites:')) {
      const match = output.match(/Test Suites:\s+(\d+)\s+failed/);
      if (match && parseInt(match[1]) > 0) {
        return false;
      }
      return output.includes('passed');
    }
    
    // 通用格式
    return output.includes('PASS') && !output.includes('FAIL');
  }
}

/**
 * 创建验收标准门禁（便捷函数）
 */
export function createSpecAcceptanceGate(config?: Partial<SpecAcceptanceGateConfig>): SpecAcceptanceGate {
  return new SpecAcceptanceGate(config);
}
