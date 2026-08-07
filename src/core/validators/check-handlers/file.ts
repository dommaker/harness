/**
 * 检查点 file_* 族处理器（工单 23）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CheckpointCheck, CheckResult, CheckpointContext } from '../../../types/checkpoint';

export function resolvePath(relativePath: string, workdir: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(workdir, relativePath);
}

export async function checkFileExists(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const filePath = resolvePath(check.config.path || '', context.workdir);
  const exists = fs.existsSync(filePath);

  return {
    checkId: check.id,
    passed: exists,
    message: exists ? `文件存在: ${filePath}` : `文件不存在: ${filePath}`,
    actual: exists,
    expected: true,
  };
}

export async function checkFileNotEmpty(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const filePath = resolvePath(check.config.path || '', context.workdir);

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

export async function checkFileContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const filePath = resolvePath(check.config.path || '', context.workdir);
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

export async function checkFileNotContains(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const filePath = resolvePath(check.config.path || '', context.workdir);
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
