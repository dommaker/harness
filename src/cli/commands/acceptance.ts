/**
 * harness acceptance 命令
 *
 * 验收标准门控，检查任务是否满足验收标准
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SpecAcceptanceGate } from '../../gates/acceptance';

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
export async function acceptance(options: AcceptanceOptions): Promise<void> {
  console.log(chalk.blue('📋 验收标准门控检查...'));

  const projectPath = options.projectPath || process.cwd();

  // 创建验收门控实例
  const gate = new SpecAcceptanceGate({
    tasksPath: options.tasksPath,
    checkAllTasks: options.checkAll,
  });

  try {
    // 执行检查
    const context = {
      projectPath,
      taskId: options.taskId,
    };

    const result = await gate.check(context as any);

    if (result.passed) {
      console.log();
      console.log(chalk.green('✅ 验收标准检查通过'));
      if (result.details) {
        console.log(chalk.gray(`   通过项: ${result.details.checkedCriteria ?? 0}`));
        console.log(chalk.gray(`   总项数: ${result.details.totalCriteria ?? 0}`));
      }
    } else {
      console.log();
      console.log(chalk.red('❌ 验收标准检查失败'));
      console.log(chalk.red(`   ${result.message}`));
      if (result.details?.uncheckedCriteria) {
        (result.details.uncheckedCriteria as string[]).forEach((criteria: string) => {
          console.log(chalk.red(`   - ${criteria}`));
        });
      }
      process.exit(1);
    }
  } catch (error: any) {
    console.log();
    console.log(chalk.red('❌ 验收标准检查出错'));
    console.log(chalk.red(`   ${error.message}`));
    process.exit(1);
  }
}

/**
 * 列出所有任务及其验收标准
 */
export async function listAcceptanceCriteria(options: AcceptanceOptions): Promise<void> {
  console.log(chalk.blue('📋 任务验收标准列表...\n'));

  const projectPath = options.projectPath || process.cwd();
  const tasksPath = options.tasksPath || path.join(projectPath, 'tasks.yml');

  try {
    const content = await fs.readFile(tasksPath, 'utf-8');
    const yaml = await import('js-yaml');
    const tasks = yaml.load(content) as any;

    if (!tasks || typeof tasks !== 'object') {
      console.log(chalk.yellow('⚠️  未找到任务定义'));
      return;
    }

    for (const [taskId, task] of Object.entries(tasks)) {
      if (typeof task === 'object' && task !== null) {
        console.log(chalk.cyan(`${taskId}:`));
        const taskObj = task as any;
        if (taskObj.acceptanceCriteria) {
          taskObj.acceptanceCriteria.forEach((criteria: string, i: number) => {
            console.log(chalk.gray(`  ${i + 1}. ${criteria}`));
          });
        } else {
          console.log(chalk.gray('  (无验收标准)'));
        }
        console.log();
      }
    }
  } catch (error: any) {
    console.log(chalk.red(`❌ 读取 tasks.yml 失败: ${error.message}`));
  }
}
