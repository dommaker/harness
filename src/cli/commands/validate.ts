/**
 * harness validate 命令
 * 
 * 验证检查点是否满足
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from '../../utils/yaml';
import { CheckpointValidator, assertCheckpointShape } from '../../core/validators/checkpoint';
import {
  createCommandExecutionPolicy,
  formatCommandPlan,
  planCommandsFromCheckpoints,
} from '../../core/command-execution-policy';
import type { Checkpoint, CheckpointContext } from '../../types/checkpoint';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { DEFAULT_CHECKPOINT_FILE } from './scaffold-templates';

export interface ValidateOptions {
  /** 检查点文件路径 */
  file?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 只读模式（CLI --read-only；D3 P0.5 Phase 1）：跳过检查点声明的命令执行 */
  readOnly?: boolean;
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
  const data = yaml.load(content) as { checkpoints?: unknown } | null;
  const checkpoints = (data as { checkpoints?: unknown } | null)?.checkpoints ?? [];
  // 逐条按 type 校验 config 必填字段（fail-fast 指名字段，不 as 强转蒙混）
  assertCheckpointShape(checkpoints, filePath);
  return checkpoints;
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

  // 运行前清单（D3 P0.5 Phase 1）：列出本次将执行的项目声明命令；--read-only 下列出被跳过的。
  // 清单只收会执行的族（command_* / 带 command 的 output_*；json_path 不执行 command 不纳入）。
  const commandPlan = planCommandsFromCheckpoints(checkpoints);
  if (commandPlan.length > 0) {
    if (options.readOnly) {
      log(io, chalk.gray(`⏭️ --read-only：跳过 ${commandPlan.length} 条项目声明命令（未执行）:`));
    } else {
      log(io, chalk.yellow(`⚠️ 本次将执行 ${commandPlan.length} 条项目声明命令:`));
    }
    formatCommandPlan(commandPlan).forEach(line => log(io, chalk.gray(line)));
  }

  // 构建上下文
  const context: CheckpointContext = {
    projectPath,
    workdir: projectPath,
    commandPolicy: createCommandExecutionPolicy({ readOnly: options.readOnly }),
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
    } else if (result.skipped) {
      // 未完整验证（read-only：声明命令未执行）——不算通过也不算失败，单独列出
      log(io, chalk.gray(`⏭️ ${checkpoint.id}: 跳过评估（命令未执行）`));
      result.checks.forEach(check => {
        if (check.skipped) {
          log(io, chalk.gray(`   - ${check.checkId}: ${check.message}${check.skipReason ? `（${check.skipReason}）` : ''}`));
        }
      });
    } else {
      log(io, chalk.red(`❌ ${checkpoint.id}: 失败`));
      result.checks.forEach(check => {
        // read-only 跳过的检查不以红色失败出现：跳过明细 + 原因（与真实失败同 checkpoint 并存时同样可见）
        if (check.skipped) {
          log(io, chalk.gray(`   - ${check.checkId}: ${check.message}${check.skipReason ? `（${check.skipReason}）` : ''}`));
          return;
        }
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
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skippedCount = results.filter(r => r.skipped).length;

  log(io);
  log(io, chalk.gray(`通过: ${passed}/${results.length}`));
  if (skippedCount > 0) {
    log(io, chalk.gray(`跳过: ${skippedCount} 个检查点（命令未执行）`));
  }

  if (failed > 0) {
    log(io, chalk.red(`\n🛑 ${failed} 个检查点未通过`));
    // 工单 23：门控语义——检查点失败一律非零退出（此前仅 --strict 退出，钩子/CI 形同虚设）
    return { kind: 'fail', reason: `${failed} 个检查点未通过: ${failedIds.join(', ')}` };
  }
  if (skippedCount > 0) {
    // read-only 无实际失败但有未评估：返回 skip（退出 0）而非 ok——不把「未完整验证」当验证通过
    return {
      kind: 'skip',
      reason: `--read-only: ${skippedCount} 个检查点未完整验证（命令未执行）`,
    };
  }
  log(io, chalk.green('\n✅ 所有检查点验证通过'));
  return { kind: 'ok' };
}
