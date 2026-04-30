/**
 * harness passes-gate 命令
 * 
 * 运行测试门控，确保测试通过
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import { PassesGate } from '../../core/validators/passes-gate';
import type { PassesGateConfig } from '../../types/passes-gate';

export interface PassesGateOptions {
  /** 测试命令 */
  testCommand?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 是否允许部分通过 */
  allowPartial?: boolean;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 检测项目的测试命令
 */
async function detectTestCommand(projectPath: string): Promise<string | undefined> {
  const packageJsonPath = path.join(projectPath, 'package.json');

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified"') {
      return 'npm test';
    }
    if (pkg.scripts?.['test:ci']) {
      return 'npm run test:ci';
    }
  } catch {
    // 没有 package.json
  }

  // 检查其他项目类型
  try {
    await fs.access(path.join(projectPath, 'pytest.ini'));
    return 'pytest';
  } catch {}

  try {
    await fs.access(path.join(projectPath, 'go.mod'));
    return 'go test ./...';
  } catch {}

  return undefined;
}

/**
 * 执行测试门控
 */
export async function runPassesGate(options: PassesGateOptions): Promise<void> {
  console.log(chalk.blue('🚦 运行测试门控...'));

  const projectPath = options.projectPath || process.cwd();

  // 检测测试命令
  let testCommand = options.testCommand;
  if (!testCommand) {
    testCommand = await detectTestCommand(projectPath);
  }

  if (!testCommand) {
    console.log(chalk.yellow('⚠️  未检测到测试命令，跳过测试门控'));
    console.log(chalk.gray('提示: 使用 --test-command 指定测试命令'));
    return;
  }

  console.log(chalk.gray(`测试命令: ${testCommand}`));

  // 配置
  const config: PassesGateConfig = {
    enabled: true,
    testCommand,
    requireEvidence: false,
    allowPartialPass: options.allowPartial || false,
    maxRetries: options.maxRetries || 2,
  };

  // 执行测试
  const passesGate = new PassesGate(config);

  try {
    const result = await passesGate.runTests();

    console.log();
    console.log(chalk.gray('测试结果:'));
    console.log(chalk.gray(`  通过: ${result.passedTests}/${result.totalTests}`));
    console.log(chalk.gray(`  失败: ${result.failedTests}/${result.totalTests}`));
    console.log(chalk.gray(`  耗时: ${result.duration}ms`));

    if (result.passed) {
      console.log();
      console.log(chalk.green('✅ 测试门控通过'));
      console.log(chalk.green('   task.passes = true (由测试结果设置)'));
    } else {
      console.log();
      console.log(chalk.red('❌ 测试门控未通过'));
      console.log(chalk.red('   task.passes = false'));
      
      if (result.failures && result.failures.length > 0) {
        console.log(chalk.red('\n失败的测试:'));
        result.failures.forEach(f => {
          console.log(chalk.red(`  - ${f.name}: ${f.message}`));
        });
      }

      process.exit(1);
    }
  } catch (error) {
    console.log(chalk.red(`\n❌ 测试执行失败: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 检查测试覆盖率
 */
export async function checkCoverage(projectPath: string, threshold: number = 80): Promise<boolean> {
  console.log(chalk.blue(`📊 检查测试覆盖率 (阈值: ${threshold}%)...`));

  try {
    // 运行覆盖率检查
    await execAsync('npm test -- --coverage --coverageReporters=json-summary', {
      cwd: projectPath,
    });

    // 读取覆盖率报告
    const coveragePath = path.join(projectPath, 'coverage', 'coverage-summary.json');
    const content = await fs.readFile(coveragePath, 'utf-8');
    const coverage = JSON.parse(content);

    const totalCoverage = coverage.total?.lines?.pct || 0;

    console.log(chalk.gray(`当前覆盖率: ${totalCoverage}%`));

    if (totalCoverage >= threshold) {
      console.log(chalk.green(`✅ 覆盖率达标 (${totalCoverage}% >= ${threshold}%)`));
      return true;
    } else {
      console.log(chalk.red(`❌ 覆盖率不足 (${totalCoverage}% < ${threshold}%)`));
      return false;
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️  无法获取覆盖率信息: ${(error as Error).message}`));
    return true; // 无法获取时跳过检查
  }
}
