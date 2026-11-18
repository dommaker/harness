/**
 * harness acceptance 命令
 *
 * 验收标准门控，检查任务是否满足验收标准
 *
 * D5：list 子命令与 SpecAcceptanceGate 共同消费 gates/tasks-file 的
 * parseTasksFile——tasks.yml 的 YAML 解析、形状校验与错误语义只有一份正本。
 * 解析失败 fail-fast（kind:fail，bin 退出 1），不存在静默 skip/空列表。
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from '../../utils/yaml';
import { SpecAcceptanceGate } from '../../gates/acceptance';
import { parseTasksFile, type TasksFile } from '../../gates/tasks-file';
import { isRecord } from '../../utils/guards';
import { errorMessage } from '../../utils/error';
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
 *
 * 与门禁同一解析契约：读取失败里只有 ENOENT 走「无 tasks.yml 即跳过」（与门禁
 * passed:true 的跳过语义一致，kind:skip → 退出 0）；其余读取失败与一切解析/
 * 形状错误一律 fail-fast（kind:fail → 退出 1），不静默 skip、不返回空列表。
 */
export async function listAcceptanceCriteria(
  options: AcceptanceOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('📋 任务验收标准列表...\n'));

  const projectPath = options.projectPath || process.cwd();
  // 与 SpecAcceptanceGate.check() 同一锚定规则：相对值一律锚 projectPath
  const tasksPath = path.resolve(projectPath, options.tasksPath ?? 'tasks.yml');

  let content: string;
  try {
    content = await fs.readFile(tasksPath, 'utf-8');
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (isRecord(error) && error.code === 'ENOENT') {
      log(io, chalk.yellow(`⚠️  未找到 tasks.yml: ${tasksPath}`));
      return { kind: 'skip', reason: `未找到 tasks.yml: ${tasksPath}` };
    }
    log(io, chalk.red(`❌ 读取 tasks.yml 失败: ${message}`));
    return { kind: 'fail', reason: `读取 tasks.yml 失败: ${message}` };
  }

  // 单一解析正本：非法 YAML/形状/任务/验收条件在此抛错（fail-fast → fail，不静默 skip）
  let tasks: TasksFile;
  try {
    tasks = parseTasksFile(yaml.load(content), tasksPath);
  } catch (error: unknown) {
    const message = errorMessage(error);
    log(io, chalk.red(`❌ tasks.yml 解析失败: ${message}`));
    return { kind: 'fail', reason: `tasks.yml 解析失败: ${message}` };
  }

  for (const task of tasks.tasks) {
    log(io, chalk.cyan(`${task.id}:`));
    if (task.acceptance && task.acceptance.length > 0) {
      task.acceptance.forEach((c, i) => {
        const e2e = c.e2e_test
          ? ` (e2e: ${c.e2e_test}${c.test_name ? `, -g ${c.test_name}` : ''})`
          : '';
        log(io, chalk.gray(`  ${i + 1}. ${c.checked ? '[✓]' : '[ ]'} ${c.description}${e2e}`));
      });
    } else {
      log(io, chalk.gray('  (无验收标准)'));
    }
    log(io);
  }
  return { kind: 'ok' };
}
