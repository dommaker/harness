/**
 * harness spec validate 命令
 *
 * 验证 Spec 文件格式
 *
 * 设计原则：
 * - 框架不包含具体 Schema 定义
 * - 项目需要定义自己的 Spec Schema
 * - 支持动态加载项目的 Schema
 *
 * 判定经返回值外溢（架构评审候选7）：批量验证的失败计数译成 fail（含失败数），
 * 无 Spec 文件译成 skip；单文件验证维持历史退出码面（无效仍为 0）。
 */

import chalk from 'chalk';
import * as path from 'path';
import { SpecValidator, validateAllSpecs } from '../../core/spec/validator';
import type { BatchSpecValidationResult, SpecValidationResult } from '../../types/spec';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface SpecValidateOptions {
  /** Schema 路径（项目定义） */
  schema?: string;
  /** 只验证暂存文件 */
  staged?: boolean;
  /** 验证指定文件 */
  file?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 详细输出 */
  verbose?: boolean;
}

/**
 * 执行 Spec 验证
 */
export async function specValidate(
  options: SpecValidateOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('📋 验证 Spec 文件...'));

  const projectPath = options.projectPath || process.cwd();
  const validator = SpecValidator.getInstance();

  // 设置 Schema 路径
  if (options.schema) {
    const absoluteSchemaPath = path.resolve(projectPath, options.schema);
    validator.setConfig({ schemaPath: absoluteSchemaPath });
    log(io, chalk.gray(`Schema 路径: ${absoluteSchemaPath}`));
  }

  let result: BatchSpecValidationResult | SpecValidationResult;

  // 单文件验证
  if (options.file) {
    const absoluteFilePath = path.resolve(projectPath, options.file);
    log(io, chalk.gray(`验证文件: ${absoluteFilePath}`));
    result = await validator.validateFile(absoluteFilePath);
    printSingleResult(result, io, options.verbose);
    return { kind: 'ok' };
  }

  // 批量验证
  log(io, chalk.gray(`项目路径: ${projectPath}`));
  log(io, chalk.gray(`仅暂存: ${options.staged ? '是' : '否'}`));
  log(io);

  result = await validateAllSpecs(projectPath, options.staged);

  // 打印结果
  printBatchResult(result, io, options.verbose);

  // 根据失败级别决定退出码
  if (!options.staged && result.failed > 0) {
    return { kind: 'fail', reason: `${result.failed} 个 Spec 文件验证失败` };
  }
  if (result.total === 0) {
    return { kind: 'skip', reason: '没有找到 Spec 文件' };
  }
  return { kind: 'ok' };
}

/**
 * 打印单个文件验证结果
 */
function printSingleResult(result: SpecValidationResult, io: CommandIO, verbose?: boolean): void {
  if (result.valid) {
    log(io, chalk.green(`✅ ${result.file} 验证通过`));
  } else {
    log(io, chalk.red(`❌ ${result.file} 验证失败`));
  }

  if (result.errors.length > 0) {
    log(io);
    log(io, chalk.red('错误:'));
    for (const error of result.errors) {
      log(io, chalk.red(`  - ${error.path ? error.path + ': ' : ''}${error.message}`));
    }
  }

  if (result.warnings.length > 0) {
    log(io);
    log(io, chalk.yellow('警告:'));
    for (const warning of result.warnings) {
      log(io, chalk.yellow(`  - ${warning.path ? warning.path + ': ' : ''}${warning.message}`));
    }
  }

  if (verbose && result.metrics) {
    log(io);
    log(io, chalk.gray('指标:'));
    for (const [key, value] of Object.entries(result.metrics)) {
      log(io, chalk.gray(`  - ${key}: ${value}`));
    }
  }
}

/**
 * 打印批量验证结果
 */
function printBatchResult(result: BatchSpecValidationResult, io: CommandIO, verbose?: boolean): void {
  // 汇总
  log(io, chalk.bold('验证结果:'));
  log(io, chalk.gray(`  总文件数: ${result.total}`));
  log(io, chalk.green(`  通过: ${result.passed}`));
  log(io, chalk.red(`  失败: ${result.failed}`));
  log(io, chalk.yellow(`  警告: ${result.warnings}`));
  log(io);

  // 详细结果
  if (verbose || result.failed > 0) {
    for (const r of result.results) {
      if (!r.valid || verbose) {
        printSingleResult(r, io, verbose);
        log(io);
      }
    }
  }

  // 成功提示
  if (result.failed === 0 && result.total > 0) {
    log(io, chalk.green('✅ 所有 Spec 文件验证通过'));
  } else if (result.total === 0) {
    log(io, chalk.gray('没有找到 Spec 文件，跳过验证'));
    log(io);
    log(io, chalk.gray('提示: Spec 文件包括:'));
    log(io, chalk.gray('  - ARCHITECTURE.md'));
    log(io, chalk.gray('  - specs/ 目录下的 .yml/.yaml 文件'));
    log(io);
    log(io, chalk.gray('要定义自己的 Schema，请在项目中创建:'));
    log(io, chalk.gray('  src/specs/schemas/index.ts'));
    log(io, chalk.gray('  导出 validate 函数'));
  }
}

/**
 * 列出支持的 Spec 类型
 */
/** 子命令实现一律以 (options) 调用；list 不消费验证选项，形参仅占位 */
export function listSpecTypes(_options: Partial<SpecValidateOptions> = {}, io: CommandIO = processIO): CommandResult {
  log(io, chalk.blue('📋 支持的 Spec 类型:'));
  log(io);
  log(io, '  architecture  - ARCHITECTURE.md 架构文档');
  log(io, '  module        - 模块定义（specs/modules/*.yml）');
  log(io, '  api           - API 定义（specs/apis/*.yml）');
  log(io, '  custom        - 自定义 Spec');
  log(io);
  log(io, chalk.gray('提示: 项目可以定义自己的 Schema 进行验证'));
  return { kind: 'ok' };
}
