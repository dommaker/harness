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
import { detectSourceRoots } from '../../utils/detect-source-roots';

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
async function loadCheckpoints(filePath: string): Promise<Checkpoint[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content) as { checkpoints?: Checkpoint[] };
    return data.checkpoints || [];
  } catch (error) {
    console.log(chalk.yellow(`⚠️  未找到检查点文件: ${filePath}`));
    return [];
  }
}

/**
 * 执行检查点验证
 */
export async function validate(options: ValidateOptions): Promise<void> {
  console.log(chalk.blue('🔍 验证检查点...'));

  const projectPath = options.projectPath || process.cwd();
  const checkpointFile = options.file || path.join(projectPath, DEFAULT_CHECKPOINT_FILE);

  // 加载检查点
  const checkpoints = await loadCheckpoints(checkpointFile);

  if (checkpoints.length === 0) {
    console.log(chalk.gray('没有定义检查点，跳过验证'));
    return;
  }

  console.log(chalk.gray(`检查点文件: ${checkpointFile}`));
  console.log(chalk.gray(`检查点数量: ${checkpoints.length}`));
  console.log();

  // 构建上下文
  const context: CheckpointContext = {
    projectPath,
    workdir: projectPath,
  };

  // 执行验证
  const validator = CheckpointValidator.getInstance();
  const results = [];

  for (const checkpoint of checkpoints) {
    const result = await validator.validate(checkpoint, context);
    results.push(result);

    if (result.passed) {
      console.log(chalk.green(`✅ ${checkpoint.id}: 通过`));
    } else {
      console.log(chalk.red(`❌ ${checkpoint.id}: 失败`));
      result.checks.forEach(check => {
        if (!check.passed) {
          console.log(chalk.red(`   - ${check.checkId}: ${check.message || check.error}`));
        }
      });
    }
  }

  // 统计结果
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log();
  console.log(chalk.gray(`通过: ${passed}/${results.length}`));

  if (failed > 0) {
    console.log(chalk.red(`\n🛑 ${failed} 个检查点未通过`));
    if (options.strict) {
      process.exit(1);
    }
  } else {
    console.log(chalk.green('\n✅ 所有检查点验证通过'));
  }
}

/**
 * 默认检查点列表（供 init 和 upgrade 共用）
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
  {
    id: 'no-console',
    name: '无 console.log',
    checks: [
      {
        id: 'check-console',
        type: 'output_not_contains',
        config: {
          command: 'grep -r "console.log" src/ || true',
          expected: '',
        },
        message: '源代码中不应包含 console.log',
      },
    ],
  },
];

/**
 * 创建示例检查点文件
 */
export async function createExampleCheckpoint(projectPath: string): Promise<void> {
  const filePath = path.join(projectPath, DEFAULT_CHECKPOINT_FILE);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  // 动态替换 no-console 检查点的源目录
  const roots = detectSourceRoots(projectPath);
  let checkpoints = DEFAULT_CHECKPOINTS;
  if (roots.length > 0) {
    checkpoints = DEFAULT_CHECKPOINTS.map(cp => {
      if (cp.id === 'no-console') {
        return {
          ...cp,
          checks: cp.checks.map(c => {
            if (c.id === 'check-console') {
              return { ...c, config: { command: `grep -r "console.log" ${roots.join(' ')} || true` } };
            }
            return c;
          }),
        };
      }
      return cp;
    });
  }

  const content = yaml.dump({ checkpoints }, { indent: 2 });
  await fs.writeFile(filePath, content, 'utf-8');

  console.log(chalk.green(`✅ 已创建示例检查点文件: ${filePath}`));
}

/**
 * 默认 Resolutions（RKB — 约束 → 已知解法映射）
 */
const DEFAULT_RESOLUTIONS = {
  no_claim_without_evidence: {
    title: 'commit message 缺少验证证据',
    fix: '在 commit message body 中附上验证输出:\n`npx harness check --staged` | `npx harness validate` | `npm test -- --coverage`\n确认全部通过后重新 commit。',
  },
  capability_sync: {
    title: '缺少 CAPABILITIES.md',
    fix: '在项目根目录创建 CAPABILITIES.md，列出所有模块能力清单。运行 `npx harness sync-docs` 可自动生成模板。',
  },
  context_doc_sync: {
    title: '关键目录缺少 CONTEXT.md',
    fix: '在 required_dirs 目录下创建 CONTEXT.md。运行 `npx harness sync-docs` 可自动生成模板。',
  },
  no_coverage_decrease: {
    title: '测试覆盖率下降',
    fix: '运行 `npm test -- --coverage` 查看当前覆盖率。新增文件必须有对应的测试文件。',
  },
};

/**
 * 创建示例 Resolutions 文件（RKB dogfood）
 */
export async function createExampleResolutions(projectPath: string): Promise<void> {
  const harnessDir = path.join(projectPath, '.harness');
  const filePath = path.join(harnessDir, 'resolutions.json');

  await fs.mkdir(harnessDir, { recursive: true });

  const content = JSON.stringify(DEFAULT_RESOLUTIONS, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');

  console.log(chalk.green(`✅ 已创建 Resolutions 文件: ${filePath}`));
}
