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
    // 执行检查
    const context = {
      projectPath,
      taskId: options.taskId,
    };

    const result = await gate.check(context as any);

    if (result.passed) {
      log(io);
      log(io, chalk.green('✅ 验收标准检查通过'));
      if (result.details) {
        log(io, chalk.gray(`   通过项: ${result.details.checkedCriteria ?? 0}`));
        log(io, chalk.gray(`   总项数: ${result.details.totalCriteria ?? 0}`));
      }
    } else {
      log(io);
      log(io, chalk.red('❌ 验收标准检查失败'));
      log(io, chalk.red(`   ${result.message}`));
      if (result.details?.uncheckedCriteria) {
        (result.details.uncheckedCriteria as string[]).forEach((criteria: string) => {
          log(io, chalk.red(`   - ${criteria}`));
        });
      }
      return { kind: 'fail', reason: `acceptance gate denied: ${result.message}` };
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io);
    log(io, chalk.red('❌ 验收标准检查出错'));
    log(io, chalk.red(`   ${error.message}`));
    return { kind: 'fail', reason: `acceptance gate error: ${error.message}` };
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
