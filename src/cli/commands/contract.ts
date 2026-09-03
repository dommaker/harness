/**
 * harness contract 命令
 *
 * API 契约门控，检查 OpenAPI Schema 验证
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ContractGate } from '../../gates/contract';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ContractOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 契约文件路径 */
  contractPath?: string;
  /** 是否严格模式 */
  strict?: boolean;
  /** 是否允许破坏性变更 */
  allowBreaking?: boolean;
}

/**
 * 执行契约门控
 */
export async function contract(
  options: ContractOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('📜 API 契约门控检查...'));

  const projectPath = options.projectPath || process.cwd();
  const contractPath = options.contractPath || 'openapi.yaml';

  // 先验证文件是否存在
  const fullPath = path.join(projectPath, contractPath);
  try {
    await fs.access(fullPath);
  } catch {
    log(io);
    log(io, chalk.red('❌ 契约文件不存在'));
    log(io, chalk.red(`   ${fullPath}`));
    return { kind: 'fail', reason: `contract file not found: ${fullPath}` };
  }

  // 创建契约门控实例
  const gate = new ContractGate({
    contractPath,
    strict: options.strict !== false, // 默认严格模式
    allowBreakingChanges: options.allowBreaking || false,
  });

  try {
    const result = await gate.check({
      projectPath,
    } as any);

    if (result.passed) {
      log(io);
      log(io, chalk.green('✅ 契约门控检查通过'));

      if (result.details) {
        log(io, chalk.gray(`   Schema 有效: ✅`));
        if (result.details.endpoints) {
          log(io, chalk.gray(`   端点数: ${result.details.endpoints}`));
        }
        if (result.details.breakingChanges === false) {
          log(io, chalk.gray(`   破坏性变更: 无`));
        }
      }
    } else {
      log(io);
      log(io, chalk.red('❌ 契约门控检查失败'));
      log(io, chalk.red(`   ${result.message}`));

      if (result.details?.errors) {
        log(io);
        log(io, chalk.red('验证错误:'));
        (result.details.errors as string[]).forEach((error: string) => {
          log(io, chalk.red(`  - ${error}`));
        });
      }

      if (result.details?.breakingChanges) {
        log(io);
        log(io, chalk.red('破坏性变更:'));
        (result.details.breakingChanges as any[]).forEach((change: any) => {
          log(io, chalk.red(`  - ${change.type}: ${change.path}`));
          if (change.description) {
            log(io, chalk.gray(`    ${change.description}`));
          }
        });
      }

      return { kind: 'fail', reason: `contract gate denied: ${result.message}` };
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io);
    log(io, chalk.red('❌ 契约门控检查出错'));
    log(io, chalk.red(`   ${error.message}`));
    return { kind: 'fail', reason: `contract gate error: ${error.message}` };
  }
}

/**
 * 验证 OpenAPI Schema 语法
 */
export async function validateSchema(
  options: ContractOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('📜 验证 OpenAPI Schema...\n'));

  const projectPath = options.projectPath || process.cwd();
  const contractPath = options.contractPath || 'openapi.yaml';

  try {
    const yaml = await import('js-yaml');

    const fullPath = path.join(projectPath, contractPath);
    const content = await fs.readFile(fullPath, 'utf-8');

    let schema: any;
    try {
      schema = yaml.load(content);
    } catch (e: any) {
      log(io, chalk.red(`❌ YAML 解析错误: ${e.message}`));
      return { kind: 'fail', reason: `contract YAML parse error: ${e.message}` };
    }

    // 基本验证
    const errors: string[] = [];

    if (!schema.openapi) {
      errors.push('缺少 openapi 字段');
    } else if (!schema.openapi.startsWith('3.')) {
      errors.push(`OpenAPI 版本建议使用 3.x，当前: ${schema.openapi}`);
    }

    if (!schema.info) {
      errors.push('缺少 info 字段');
    } else {
      if (!schema.info.title) errors.push('缺少 info.title');
      if (!schema.info.version) errors.push('缺少 info.version');
    }

    if (!schema.paths || Object.keys(schema.paths).length === 0) {
      errors.push('缺少 paths 字段或路径为空');
    }

    if (errors.length > 0) {
      log(io, chalk.red('❌ Schema 验证失败:\n'));
      errors.forEach(err => log(io, chalk.red(`  - ${err}`)));
      return { kind: 'fail', reason: `contract schema invalid: ${errors.join('; ')}` };
    }

    log(io, chalk.green('✅ Schema 验证通过'));
    log(io);
    log(io, chalk.gray('Schema 信息:'));
    log(io, chalk.gray(`  版本: ${schema.openapi}`));
    log(io, chalk.gray(`  标题: ${schema.info.title}`));
    log(io, chalk.gray(`  API 版本: ${schema.info.version}`));

    if (schema.paths) {
      const endpoints = Object.keys(schema.paths).flatMap(path =>
        Object.keys(schema.paths[path]).map(method => `${method.toUpperCase()} ${path}`)
      );
      log(io, chalk.gray(`  端点数: ${endpoints.length}`));
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io, chalk.red(`❌ 验证失败: ${error.message}`));
    return { kind: 'fail', reason: `contract schema read error: ${error.message}` };
  }
}
