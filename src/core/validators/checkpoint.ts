/**
 * 检查点验证引擎（编排层，工单 23）
 *
 * 在每个步骤执行后，自动验证检查点是否满足。
 * 各检查族实现位于 check-handlers/{file,command,output,http}.ts。
 */

import type {
  Checkpoint,
  CheckpointCheck,
  CheckpointResult,
  CheckResult,
  CheckpointContext,
  CheckType,
} from '../../types/checkpoint';
import {
  checkFileExists,
  checkFileNotEmpty,
  checkFileContains,
  checkFileNotContains,
} from './check-handlers/file';
import { checkCommandSuccess, checkCommandOutput } from './check-handlers/command';
import {
  checkOutputContains,
  checkOutputNotContains,
  checkOutputMatches,
  checkJsonPath,
} from './check-handlers/output';
import { checkHttpStatus, checkHttpBody } from './check-handlers/http';

/**
 * 检查点验证器
 */
export class CheckpointValidator {
  private static instance: CheckpointValidator;

  /**
   * 支持的检查类型列表
   */
  private static readonly SUPPORTED_CHECK_TYPES: CheckType[] = [
    'file_exists',
    'file_not_empty',
    'file_contains',
    'file_not_contains',
    'command_success',
    'command_output',
    'output_contains',
    'output_not_contains',
    'output_matches',
    'json_path',
    'http_status',
    'http_body',
    'custom',
  ];

  private constructor() {}

  static getInstance(): CheckpointValidator {
    if (!CheckpointValidator.instance) {
      CheckpointValidator.instance = new CheckpointValidator();
    }
    return CheckpointValidator.instance;
  }

  /**
   * 获取支持的检查类型
   */
  getSupportedCheckTypes(): CheckType[] {
    return [...CheckpointValidator.SUPPORTED_CHECK_TYPES];
  }

  /**
   * 验证检查点
   */
  async validate(checkpoint: Checkpoint, context: CheckpointContext): Promise<CheckpointResult> {
    if (!checkpoint || !checkpoint.checks || checkpoint.checks.length === 0) {
      return {
        checkpointId: checkpoint?.id || 'unknown',
        passed: true,
        checks: [],
        message: '无检查点要求',
        validatedAt: new Date(),
      };
    }

    const results: CheckResult[] = [];

    for (const check of checkpoint.checks) {
      const result = await this.executeCheck(check, context);
      results.push(result);
    }

    const allPassed = results.every(r => r.passed);

    return {
      checkpointId: checkpoint.id,
      passed: allPassed,
      checks: results,
      message: allPassed ? '检查点验证通过' : '检查点验证失败',
      validatedAt: new Date(),
    };
  }

  /**
   * 执行单个检查项（分发至 check-handlers/ 各族）
   */
  private async executeCheck(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    try {
      switch (check.type) {
        case 'file_exists':
          return await checkFileExists(check, context);
        case 'file_not_empty':
          return await checkFileNotEmpty(check, context);
        case 'file_contains':
          return await checkFileContains(check, context);
        case 'file_not_contains':
          return await checkFileNotContains(check, context);
        case 'command_success':
          return await checkCommandSuccess(check, context);
        case 'command_output':
          return await checkCommandOutput(check, context);
        case 'output_contains':
          return await checkOutputContains(check, context);
        case 'output_not_contains':
          return await checkOutputNotContains(check, context);
        case 'output_matches':
          return await checkOutputMatches(check, context);
        case 'json_path':
          return await checkJsonPath(check, context);
        case 'http_status':
          return await checkHttpStatus(check, context);
        case 'http_body':
          return await checkHttpBody(check, context);
        case 'custom':
          return await this.checkCustom(check, context);
        default:
          return {
            checkId: check.id,
            passed: false,
            message: `未知检查类型: ${check.type}`,
            error: `Unknown check type: ${check.type}`,
          };
      }
    } catch (error) {
      return {
        checkId: check.id,
        passed: false,
        message: `检查执行失败: ${(error as Error).message}`,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 自定义检查
   */
  private async checkCustom(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    // 检查是否有自定义处理器
    const handler = context.customHandlers?.get(check.config.customFunction || '');

    if (handler) {
      return await handler(check.config);
    }

    return {
      checkId: check.id,
      passed: false,
      message: `自定义检查未实现: ${check.config.customFunction}`,
      error: 'Custom check not implemented',
    };
  }
}
