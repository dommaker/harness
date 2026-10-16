/**
 * doc_regex_count 检查（自 runner.ts 拆出，重构班次 3 Phase 4）
 *
 * 文档声明计数（正则提取）↔ 实际计数（目录扫描 / grep 匹配 / 固定值）对照。
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { DocRegexCountCheck } from '../../../types/project-config';
import type { FreshnessCheckResult, RunContext } from './runner';

export function checkDocRegexCount(
  check: DocRegexCountCheck,
  ctx: RunContext
): FreshnessCheckResult {
  // fail-fast：doc 缺失/无计数行/计数解析失败按显式分支跳过；其余异常抛出（同 checkDocDir）
  const docPath = join(ctx.projectPath, check.doc);
  if (!existsSync(docPath)) {
    return {
      type: 'doc_regex_count',
      label: `${check.doc} / ${check.label}`,
      pass: true,
      message: `${check.doc} 不存在，跳过检查`,
    };
  }

  const content = readFileSync(docPath, 'utf-8');

  // 从文档中提取声明的计数
  const countRegex = new RegExp(check.pattern);
  const countMatch = content.match(countRegex);
  if (!countMatch || countMatch[1] === undefined) {
    return {
      type: 'doc_regex_count',
      label: `${check.doc} / ${check.label}`,
      pass: true,
      message: `未在 ${check.doc} 中找到匹配 "${check.label}" 的计数行`,
    };
  }

  const docCount = parseInt(countMatch[1], 10);
  if (isNaN(docCount)) {
    return {
      type: 'doc_regex_count',
      label: `${check.doc} / ${check.label}`,
      pass: true,
      message: `计数解析失败: ${countMatch[1]}`,
    };
  }

  // 获取实际计数
  let actualCount: number;
  if (check.actual.kind === 'dir_count') {
    actualCount = countFromDir(check.actual.path, check.actual.extension || '.ts', check.actual.exclude || [], ctx.projectPath);
  } else if (check.actual.kind === 'grep_count') {
    actualCount = countFromGrep(ctx.projectPath, check.actual.glob, check.actual.pattern);
  } else {
    actualCount = check.actual.value;
  }

  if (actualCount < 0) {
    return {
      type: 'doc_regex_count',
      label: `${check.doc} / ${check.label}`,
      pass: true,
    };
  }

  const pass = docCount === actualCount;
  return {
    type: 'doc_regex_count',
    label: `${check.doc} / ${check.label}`,
    pass,
    message: pass ? undefined : `${check.label}: 文档 ${docCount} → 实际 ${actualCount}`,
    detail: { docCount, actualCount },
  };
}

/**
 * 从目录中计数匹配的文件/条目
 */
export function countFromDir(
  dirPath: string,
  extension: string,
  exclude: string[],
  projectPath: string
): number {
  const absDir = join(projectPath, dirPath);
  if (!existsSync(absDir)) return -1;

  // existsSync 过了却读不出 = 真 IO 故障 → 抛出（fail-fast），不再吞成 -1 假 pass
  const entries = readdirSync(absDir, { withFileTypes: true });
  const excludeSet = new Set(exclude);

  let count = 0;
  for (const entry of entries) {
    if (excludeSet.has(entry.name)) continue;

    if (entry.isDirectory() && !entry.name.startsWith('__') && !entry.name.startsWith('.')) {
      // 目录：计 1（.ts 过滤不适用于目录）
      count++;
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      // 排除 .d.ts
      if (!entry.name.endsWith('.d.ts')) {
        count++;
      }
    }
  }

  return count;
}

/**
 * 从 grep 匹配中计数
 */
export function countFromGrep(
  projectPath: string,
  globPattern: string,
  pattern: string
): number {
  // globPattern 如 "src/gates/*.ts"
  const absGlob = join(projectPath, globPattern);

  // 分离目录和文件名模式
  const lastSlash = absGlob.lastIndexOf('/');
  const searchDir = absGlob.substring(0, lastSlash);
  const filePattern = absGlob.substring(lastSlash + 1);

  if (!existsSync(searchDir)) return -1;

  // 将 glob * 转换为简单的 endsWith 检查
  const suffix = filePattern.replace(/\*/g, '');

  // fail-fast：目录在而读不出、文件扫描中途不可读、pattern 非法等真异常直接抛，
  // 不再吞成 -1（-1 在调用方 = 静默 pass，会把计数 bug 变成「永远通过」）
  const entries = readdirSync(searchDir, { withFileTypes: true });

  // 正则提出循环：String.match 带 g flag 时不携带 lastIndex 状态（每次调用内部归零），复用安全
  const matchRe = new RegExp(pattern, 'g');

  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(suffix)) continue;

    const content = readFileSync(join(searchDir, entry.name), 'utf-8');
    const matches = content.match(matchRe);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}
