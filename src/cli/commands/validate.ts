/**
 * harness validate 命令
 * 
 * 验证检查点是否满足
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CheckpointValidator } from '../../core/validators/checkpoint';
import type { Checkpoint, CheckpointContext } from '../../types/checkpoint';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { DEFAULT_CHECKPOINT_FILE } from './scaffold-templates';

export interface ValidateOptions {
  /** 检查点文件路径 */
  file?: string;
  /** 项目路径 */
  projectPath?: string;
}

/**
 * 加载检查点配置
 *
 * 缺失（ENOENT）= 合法空（返回 []）；YAML 损坏 / 读取失败（权限等）= 抛出
 * （fail-fast：损坏 ≠ 缺失，损坏被报成「未找到」会让门禁在脏配置上永远放行）。
 */
async function loadCheckpoints(filePath: string, io: CommandIO): Promise<Checkpoint[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log(io, chalk.yellow(`⚠️  未找到检查点文件: ${filePath}`));
      return [];
    }
    throw error;
  }
  const data = yaml.load(content) as { checkpoints?: Checkpoint[] } | undefined;
  return data?.checkpoints || [];
}

/**
 * 执行检查点验证
 */
export async function validate(
  options: ValidateOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('🔍 验证检查点...'));

  const projectPath = options.projectPath || process.cwd();
  const checkpointFile = options.file || path.join(projectPath, DEFAULT_CHECKPOINT_FILE);

  // 加载检查点
  const checkpoints = await loadCheckpoints(checkpointFile, io);

  if (checkpoints.length === 0) {
    log(io, chalk.gray('没有定义检查点，跳过验证'));
    return { kind: 'skip', reason: `没有定义检查点: ${checkpointFile}` };
  }

  log(io, chalk.gray(`检查点文件: ${checkpointFile}`));
  log(io, chalk.gray(`检查点数量: ${checkpoints.length}`));
  log(io);

  // 构建上下文
  const context: CheckpointContext = {
    projectPath,
    workdir: projectPath,
  };

  // 执行验证
  const validator = new CheckpointValidator();
  const results = [];
  const failedIds: string[] = [];

  for (const checkpoint of checkpoints) {
    const result = await validator.validate(checkpoint, context);
    results.push(result);

    if (result.passed) {
      log(io, chalk.green(`✅ ${checkpoint.id}: 通过`));
    } else {
      log(io, chalk.red(`❌ ${checkpoint.id}: 失败`));
      result.checks.forEach(check => {
        if (!check.passed) {
          log(io, chalk.red(`   - ${check.checkId}: ${check.message || check.error}`));
          // error 与 message 不同即带了额外信息（退出码、输出末段），打出来。
          // 此前只打 message，真因（如 stdout maxBuffer length exceeded）在输出里无处可寻。
          if (check.error && check.error !== check.message) {
            check.error.split('\n').forEach(line => {
              log(io, chalk.gray(`       ${line}`));
            });
          }
        }
      });
      failedIds.push(checkpoint.id);
    }
  }

  // 统计结果
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log(io);
  log(io, chalk.gray(`通过: ${passed}/${results.length}`));

  if (failed > 0) {
    log(io, chalk.red(`\n🛑 ${failed} 个检查点未通过`));
    // 工单 23：门控语义——检查点失败一律非零退出（此前仅 --strict 退出，钩子/CI 形同虚设）
    return { kind: 'fail', reason: `${failed} 个检查点未通过: ${failedIds.join(', ')}` };
  }
  log(io, chalk.green('\n✅ 所有检查点验证通过'));
  return { kind: 'ok' };
}
