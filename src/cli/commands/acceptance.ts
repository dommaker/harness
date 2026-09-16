/**
 * harness acceptance 命令
 *
 * 验收标准门控，检查任务是否满足验收标准
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SpecAcceptanceGate } from '../../gates/acceptance';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { reportGateDecision, reportGateError } from '../gate-command';


export interface AcceptanceOptions {
  /** 任务 ID */
  taskId?: string;
  /** tasks.yml 路径 */
  tasksPath?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 是否检查所有任务 */
  checkAll?: boolean;
  /** 是否运行 E2E 测试 */
  runE2e?: boolean;
}

/**
 * 执行验收门控
 */
export async function acceptance(
  options: AcceptanceOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('📋 验收标准门控检查...'));

  const projectPath = options.projectPath || process.cwd();

  // 创建验收门控实例
  const gate = new SpecAcceptanceGate({
    tasksPath: options.tasksPath,
    checkAllTasks: options.checkAll,
    e2eTestCommand: options.runE2e ? 'npx playwright test' : undefined,
  });

  try {
    const decision = await gate.evaluate({
      projectPath,
      taskId: options.taskId,
    });

    return reportGateDecision(
      io,
      {
        gateId: 'acceptance',
        label: '验收标准',
        onPass: (r) =>
          r.details
            ? [
                chalk.gray(`   通过项: ${r.details.checkedCriteria ?? 0}`),
                chalk.gray(`   总项数: ${r.details.totalCriteria ?? 0}`),
              ]
            : [],
        onFail: (r) =>
          r.details?.uncheckedCriteria
            ? (r.details.uncheckedCriteria as string[]).map((criteria: string) => chalk.red(`   - ${criteria}`))
            : [],
      },
      decision
    );
  } catch (error) {
    return reportGateError(io, 'acceptance', '验收标准', error);
  }
}

/**
 * 列出所有任务及其验收标准
 */
export async function listAcceptanceCriteria(
  options: AcceptanceOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('📋 任务验收标准列表...\n'));

  const projectPath = options.projectPath || process.cwd();
  const tasksPath = options.tasksPath || path.join(projectPath, 'tasks.yml');

  try {
    const content = await fs.readFile(tasksPath, 'utf-8');
    const yaml = await import('js-yaml');
    const tasks = yaml.load(content) as any;

    if (!tasks || typeof tasks !== 'object') {
      log(io, chalk.yellow('⚠️  未找到任务定义'));
      return { kind: 'skip', reason: `未找到任务定义: ${tasksPath}` };
    }

    for (const [taskId, task] of Object.entries(tasks)) {
      if (typeof task === 'object' && task !== null) {
        log(io, chalk.cyan(`${taskId}:`));
        const taskObj = task as any;
        if (taskObj.acceptanceCriteria) {
          taskObj.acceptanceCriteria.forEach((criteria: string, i: number) => {
            log(io, chalk.gray(`  ${i + 1}. ${criteria}`));
          });
        } else {
          log(io, chalk.gray('  (无验收标准)'));
        }
        log(io);
      }
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io, chalk.red(`❌ 读取 tasks.yml 失败: ${error.message}`));
    return { kind: 'skip', reason: `读取 tasks.yml 失败: ${error.message}` };
  }
}
