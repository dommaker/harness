/**
 * 检查点验证引擎
 * 
 * 在每个步骤执行后，自动验证检查点是否满足
 */

import * as fs from 'fs';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import type {
  Checkpoint,
  CheckpointCheck,
  CheckpointResult,
  CheckResult,
  CheckpointContext,
  CheckType,
} from '../../types/checkpoint';


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
   * 执行单个检查项
   */
  private async executeCheck(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    try {
      switch (check.type) {
        case 'file_exists':
          return await this.checkFileExists(check, context);
        case 'file_not_empty':
          return await this.checkFileNotEmpty(check, context);
        case 'file_contains':
          return await this.checkFileContains(check, context);
        case 'file_not_contains':
          return await this.checkFileNotContains(check, context);
        case 'command_success':
          return await this.checkCommandSuccess(check, context);
        case 'command_output':
          return await this.checkCommandOutput(check, context);
        case 'output_contains':
          return await this.checkOutputContains(check, context);
        case 'output_not_contains':
          return await this.checkOutputNotContains(check, context);
        case 'output_matches':
          return await this.checkOutputMatches(check, context);
        case 'json_path':
          return await this.checkJsonPath(check, context);
        case 'http_status':
          return await this.checkHttpStatus(check, context);
        case 'http_body':
          return await this.checkHttpBody(check, context);
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
   * 检查文件是否存在
   */
  private async checkFileExists(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const filePath = this.resolvePath(check.config.path || '', context.workdir);
    const exists = fs.existsSync(filePath);

    return {
      checkId: check.id,
      passed: exists,
      message: exists ? `文件存在: ${filePath}` : `文件不存在: ${filePath}`,
      actual: exists,
      expected: true,
    };
  }

  /**
   * 检查文件非空
   */
  private async checkFileNotEmpty(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const filePath = this.resolvePath(check.config.path || '', context.workdir);
    
    if (!fs.existsSync(filePath)) {
      return {
        checkId: check.id,
        passed: false,
        message: `文件不存在: ${filePath}`,
        actual: false,
        expected: true,
      };
    }

    const stats = fs.statSync(filePath);
    const notEmpty = stats.size > 0;

    return {
      checkId: check.id,
      passed: notEmpty,
      message: notEmpty ? `文件非空: ${filePath}` : `文件为空: ${filePath}`,
      actual: stats.size,
      expected: '> 0',
    };
  }

  /**
   * 检查文件包含内容
   */
  private async checkFileContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const filePath = this.resolvePath(check.config.path || '', context.workdir);
    const content = check.config.content || '';

    if (!fs.existsSync(filePath)) {
      return {
        checkId: check.id,
        passed: false,
        message: `文件不存在: ${filePath}`,
        actual: null,
        expected: content,
      };
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const contains = fileContent.includes(content);

    return {
      checkId: check.id,
      passed: contains,
      message: contains ? `文件包含内容: ${content}` : `文件不包含内容: ${content}`,
      actual: contains,
      expected: true,
    };
  }

  /**
   * 检查文件不包含内容
   */
  private async checkFileNotContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const filePath = this.resolvePath(check.config.path || '', context.workdir);
    const content = check.config.content || '';

    if (!fs.existsSync(filePath)) {
      return {
        checkId: check.id,
        passed: false,
        message: `文件不存在: ${filePath}`,
        actual: null,
        expected: `不包含: ${content}`,
      };
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const notContains = !fileContent.includes(content);

    return {
      checkId: check.id,
      passed: notContains,
      message: notContains ? `文件不包含内容: ${content}` : `文件包含内容: ${content}`,
      actual: !notContains,
      expected: false,
    };
  }

  /**
   * 检查命令执行成功
   */
  private async checkCommandSuccess(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const command = check.config.command || '';

    try {
      const { stdout, stderr } = await execAsync(command, { cwd: context.workdir });
      return {
        checkId: check.id,
        passed: true,
        message: `命令执行成功: ${command}`,
        actual: stdout.trim(),
        expected: 'exit code 0',
      };
    } catch (error: any) {
      return {
        checkId: check.id,
        passed: false,
        message: `命令执行失败: ${command}`,
        actual: error.message,
        expected: 'exit code 0',
        error: error.message,
      };
    }
  }

  /**
   * 检查命令输出
   */
  private async checkCommandOutput(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const command = check.config.command || '';
    const expected = String(check.config.expected || '');

    try {
      const { stdout } = await execAsync(command, { cwd: context.workdir });
      const actual = stdout.trim();
      const matches = actual.includes(expected);

      return {
        checkId: check.id,
        passed: matches,
        message: matches ? `命令输出匹配: ${expected}` : `命令输出不匹配: ${expected}`,
        actual,
        expected,
      };
    } catch (error: any) {
      return {
        checkId: check.id,
        passed: false,
        message: `命令执行失败: ${command}`,
        actual: error.message,
        expected,
        error: error.message,
      };
    }
  }

  /**
   * 检查输出包含内容
   */
  private async checkOutputContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const output = this.stringifyOutput(context.output);
    const content = check.config.content || String(check.config.expected || '');
    const contains = output.includes(content);

    return {
      checkId: check.id,
      passed: contains,
      message: contains ? `输出包含内容: ${content}` : `输出不包含内容: ${content}`,
      actual: contains,
      expected: true,
    };
  }

  /**
   * 检查输出不包含内容
   */
  private async checkOutputNotContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const output = this.stringifyOutput(context.output);
    const content = check.config.content || String(check.config.expected || '');
    const notContains = !output.includes(content);

    return {
      checkId: check.id,
      passed: notContains,
      message: notContains ? `输出不包含内容: ${content}` : `输出包含内容: ${content}`,
      actual: !notContains,
      expected: false,
    };
  }

  /**
   * 检查输出匹配正则
   */
  private async checkOutputMatches(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const output = this.stringifyOutput(context.output);
    const pattern = check.config.pattern || '';
    const regex = new RegExp(pattern, 'gm');
    const matches = regex.test(output);

    return {
      checkId: check.id,
      passed: matches,
      message: matches ? `输出匹配正则: ${pattern}` : `输出不匹配正则: ${pattern}`,
      actual: matches,
      expected: true,
    };
  }

  /**
   * 检查 JSON 路径
   */
  private async checkJsonPath(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const jsonPath = check.config.jsonPath || '';
    const expected = check.config.expected;

    let actual: any;
    try {
      actual = this.getJsonValue(context.output, jsonPath);
    } catch (error) {
      return {
        checkId: check.id,
        passed: false,
        message: `JSON 路径无效: ${jsonPath}`,
        actual: null,
        expected,
        error: (error as Error).message,
      };
    }

    const matches = JSON.stringify(actual) === JSON.stringify(expected);

    return {
      checkId: check.id,
      passed: matches,
      message: matches ? `JSON 路径匹配: ${jsonPath}` : `JSON 路径不匹配: ${jsonPath}`,
      actual,
      expected,
    };
  }

  /**
   * 检查 HTTP 状态码
   */
  private async checkHttpStatus(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const url = check.config.url || '';
    const expected = check.config.expectedStatus || check.config.expected || 200;

    try {
      const response = await fetch(url);
      const actual = response.status;
      const matches = actual === expected;

      return {
        checkId: check.id,
        passed: matches,
        message: matches ? `HTTP 状态码匹配: ${expected}` : `HTTP 状态码不匹配: ${actual} != ${expected}`,
        actual,
        expected,
      };
    } catch (error: any) {
      return {
        checkId: check.id,
        passed: false,
        message: `HTTP 请求失败: ${url}`,
        actual: error.message,
        expected,
        error: error.message,
      };
    }
  }

  /**
   * 检查 HTTP 响应体
   */
  private async checkHttpBody(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    const url = check.config.url || '';
    const expected = String(check.config.expected || '');

    try {
      const response = await fetch(url, {
        method: check.config.method || 'GET',
        headers: check.config.headers,
        body: check.config.body ? JSON.stringify(check.config.body) : undefined,
      });
      const actual = await response.text();
      const contains = actual.includes(expected);

      return {
        checkId: check.id,
        passed: contains,
        message: contains ? `HTTP 响应体包含: ${expected}` : `HTTP 响应体不包含: ${expected}`,
        actual,
        expected,
      };
    } catch (error: any) {
      return {
        checkId: check.id,
        passed: false,
        message: `HTTP 请求失败: ${url}`,
        actual: error.message,
        expected,
        error: error.message,
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

  /**
   * 解析路径
   */
  private resolvePath(relativePath: string, workdir: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.join(workdir, relativePath);
  }

  /**
   * 将输出转换为字符串
   */
  private stringifyOutput(output: any): string {
    if (typeof output === 'string') {
      return output;
    }
    if (output === null || output === undefined) {
      return '';
    }
    return JSON.stringify(output);
  }

  /**
   * 获取 JSON 值
   */
  private getJsonValue(obj: any, jsonPath: string): any {
    const parts = jsonPath.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }
}

// 导出单例
export const checkpointValidator = CheckpointValidator.getInstance();

/**
 * 快捷函数：验证检查点
 */
export async function validateCheckpoint(
  checkpoint: Checkpoint,
  context: CheckpointContext
): Promise<CheckpointResult> {
  return checkpointValidator.validate(checkpoint, context);
}
