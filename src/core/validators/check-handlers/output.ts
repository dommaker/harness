/**
 * 检查点 output_* 族处理器（工单 23）
 *
 * 修复（工单 23 / 工单 06 决议）：output_* 族此前只读 context.output，
 * 从不执行 config.command——dogfooding 的 no-console 检查点因此形同虚设。
 * 现语义：context.output 已提供则用之；否则执行 config.command 取其 stdout。
 * expected/content 为空串时按「输出应为空」判定（'' 恒被 includes 匹配的老 bug 移除）。
 */

import { execAsync } from '../../../utils/exec';
import type { CheckpointCheck, CheckResult, CheckpointContext } from '../../../types/checkpoint';

export function stringifyOutput(output: any): string {
  if (typeof output === 'string') {
    return output;
  }
  if (output === null || output === undefined) {
    return '';
  }
  return JSON.stringify(output);
}

/**
 * 取得待检查的输出：context.output 优先；未提供且配置了 command 时执行之。
 * 返回 [输出文本, 命令执行错误（若有）]
 */
async function resolveOutput(
  check: CheckpointCheck,
  context: CheckpointContext
): Promise<{ output: string; commandError?: string }> {
  if (context.output !== undefined && context.output !== null) {
    return { output: stringifyOutput(context.output) };
  }
  const command = check.config.command;
  if (typeof command === 'string' && command.length > 0) {
    try {
      const { stdout } = await execAsync(command, { cwd: context.workdir });
      return { output: stdout };
    } catch (error: any) {
      return { output: '', commandError: error.message };
    }
  }
  return { output: '' };
}

export async function checkOutputContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const { output, commandError } = await resolveOutput(check, context);
  if (commandError) {
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${check.config.command}`,
      actual: commandError,
      expected: 'exit code 0',
      error: commandError,
    };
  }

  const content = check.config.content || String(check.config.expected || '');
  // 空内容恒真（包含空串无意义）
  const contains = content === '' ? true : output.includes(content);

  return {
    checkId: check.id,
    passed: contains,
    message: contains ? `输出包含内容: ${content}` : `输出不包含内容: ${content}`,
    actual: contains,
    expected: true,
  };
}

export async function checkOutputNotContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const { output, commandError } = await resolveOutput(check, context);
  if (commandError) {
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${check.config.command}`,
      actual: commandError,
      expected: 'exit code 0',
      error: commandError,
    };
  }

  const content = check.config.content || String(check.config.expected || '');
  // 空内容 → 语义为「输出应为空」（修复 '' 恒被 includes 匹配的老 bug）
  const notContains = content === '' ? output.trim().length === 0 : !output.includes(content);

  return {
    checkId: check.id,
    passed: notContains,
    message: notContains ? `输出不包含内容: ${content}` : `输出包含内容: ${content}`,
    actual: !notContains,
    expected: false,
  };
}

export async function checkOutputMatches(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const { output, commandError } = await resolveOutput(check, context);
  if (commandError) {
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${check.config.command}`,
      actual: commandError,
      expected: 'exit code 0',
      error: commandError,
    };
  }

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

export async function checkJsonPath(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const jsonPath = check.config.jsonPath || '';
  const expected = check.config.expected;

  let actual: any;
  try {
    actual = getJsonValue(context.output, jsonPath);
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

function getJsonValue(obj: any, jsonPath: string): any {
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
