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

/** 读文本：existsSync 之后的权限/竞争失败回带诊断文本，由调用族判失败（同 command 族口径） */
function readFileContent(filePath: string): { content: string } | { error: string } {
  try {
    return { content: fs.readFileSync(filePath, 'utf-8') };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
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

  // existsSync 与 stat 之间文件被删/无权限：文本即诊断，判失败回带（同 command 族口径）
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      checkId: check.id,
      passed: false,
      message: `文件读取失败: ${filePath}`,
      actual: detail,
      expected: '> 0',
      error: detail,
    };
  }
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

  const read = readFileContent(filePath);
  if ('error' in read) {
    return {
      checkId: check.id,
      passed: false,
      message: `文件读取失败: ${filePath}`,
      actual: read.error,
      expected: content,
      error: read.error,
    };
  }
  const contains = read.content.includes(content);

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

  const read = readFileContent(filePath);
  if ('error' in read) {
    return {
      checkId: check.id,
      passed: false,
      message: `文件读取失败: ${filePath}`,
      actual: read.error,
      expected: `不包含: ${content}`,
      error: read.error,
    };
  }
  const notContains = !read.content.includes(content);

  return {
    checkId: check.id,
    passed: notContains,
    message: notContains ? `文件不包含内容: ${content}` : `文件包含内容: ${content}`,
    actual: !notContains,
    expected: false,
  };
}
