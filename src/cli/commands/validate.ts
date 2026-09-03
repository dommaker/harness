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

export interface ValidateOptions {
  /** 检查点文件路径 */
  file?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 是否严格模式 */
  strict?: boolean;
}

/**
 * 默认检查点文件路径
 */
const DEFAULT_CHECKPOINT_FILE = '.harness/checkpoints.yml';

/**
 * 加载检查点配置
 */
async function loadCheckpoints(filePath: string, io: CommandIO): Promise<Checkpoint[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content) as { checkpoints?: Checkpoint[] };
    return data.checkpoints || [];
  } catch (error) {
    log(io, chalk.yellow(`⚠️  未找到检查点文件: ${filePath}`));
    return [];
  }
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
  const validator = CheckpointValidator.getInstance();
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

/**
 * 默认检查点列表（供 init 和 upgrade 共用）
 *
 * 注：no-console 检查点已移除（工单 23/24）——CLI 产品 src/ 必然有合法 console 输出，
 * 且旧配置 expected:'' 语义恒错；output_* 族修复为真正执行 config.command 后该检查会恒失败。
 */
export const DEFAULT_CHECKPOINTS: Checkpoint[] = [
  {
    id: 'build-success',
    name: '构建成功',
    checks: [
      {
        id: 'build-command',
        type: 'command_success',
        config: { command: 'npm run build' },
        message: '构建命令必须成功执行',
      },
    ],
  },
  {
    id: 'test-pass',
    name: '测试通过',
    checks: [
      {
        id: 'test-command',
        type: 'command_success',
        config: { command: 'npm test' },
        message: '测试命令必须成功执行',
      },
    ],
  },
];

/**
 * 创建示例检查点文件
 */
export async function createExampleCheckpoint(projectPath: string, io: CommandIO = processIO): Promise<void> {
  const filePath = path.join(projectPath, DEFAULT_CHECKPOINT_FILE);
  const dir = path.dirname(filePath);

  // 如果已存在，不覆盖
  try {
    await fs.access(filePath);
    log(io, chalk.gray(`checkpoints.yml 已存在，跳过`));
    return;
  } catch {
    // 文件不存在，创建
  }

  await fs.mkdir(dir, { recursive: true });

  const content = yaml.dump({ checkpoints: DEFAULT_CHECKPOINTS }, { indent: 2 });
  await fs.writeFile(filePath, content, 'utf-8');

  log(io, chalk.green(`✅ 已创建示例检查点文件: ${filePath}`));
}

/**
 * 默认 Resolutions（RKB — 约束 → 已知解法映射）
 */
const DEFAULT_RESOLUTIONS = {
  no_fuzzy_completion_claim: {
    title: 'commit message 缺少验证证据',
    fix: '在 commit message body 中附上验证输出:\n`npx @dommaker/harness check --staged` | `npx @dommaker/harness validate` | `npm test -- --coverage`\n确认全部通过后重新 commit。',
  },
  capability_sync: {
    title: '缺少 CAPABILITIES.md',
    fix: '在项目根目录创建 CAPABILITIES.md，列出所有模块能力清单。运行 `npx @dommaker/harness sync-docs` 可自动生成模板。',
  },
  context_doc_sync: {
    title: '关键目录缺少 CONTEXT.md',
    fix: '在 required_dirs 目录下创建 CONTEXT.md。运行 `npx @dommaker/harness sync-docs` 可自动生成模板。',
  },
};

/**
 * 创建示例 Resolutions 文件（RKB dogfood）
 */
export async function createExampleResolutions(projectPath: string, io: CommandIO = processIO): Promise<void> {
  const harnessDir = path.join(projectPath, '.harness');
  const filePath = path.join(harnessDir, 'resolutions.json');

  // 如果已存在，不覆盖
  try {
    await fs.access(filePath);
    log(io, chalk.gray(`resolutions.json 已存在，跳过`));
    return;
  } catch {
    // 文件不存在，创建
  }

  await fs.mkdir(harnessDir, { recursive: true });

  const content = JSON.stringify(DEFAULT_RESOLUTIONS, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');

  log(io, chalk.green(`✅ 已创建 Resolutions 文件: ${filePath}`));
}
