/**
 * CAPABILITIES.md 表格解析（工单 19-B）
 *
 * 此前 checker.parseCapabilitiesFiles 与 sync-docs.parseCapabilitiesFiles
 * 各持一份正则，收敛到此处。
 */

import * as fs from 'fs';

/** 匹配表格单元格中的源码文件条目（如 `src/foo.ts`、`foo.tsx`） */
const FILE_CELL_REGEX = /\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/g;

/** 仅匹配表格第二列的文件条目（checker 的历史语义：第一列为模块名，第二列为文件） */
const FILE_SECOND_COLUMN_REGEX = /^\|[^|]+\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/gm;

/**
 * 匹配表格单元格中的目录条目（如 `agents/`）。
 *
 * 仅匹配纯路径样式的单元格（字母/数字/._/-/@ 与 / 组成、以 / 结尾），
 * 否则以 / 结尾的散文描述（如 JSDoc 首行在 "gitRepo /" 处换行）会被误判为
 * 目录条目，导致 --check 永远报「包含已删除的模块」不收敛（2026-08-04 studio PR #44）
 */
const DIR_CELL_REGEX = /\|\s*([\w][\w@./-]*\/)\s*\|/g;

export interface CapabilitiesParseOptions {
  /** 是否同时收集目录条目（sync-docs 需要；checker 只做文件覆盖比对，不需要） */
  includeDirs?: boolean;
  /** 只取表格第二列的文件条目（checker 的历史严格语义），默认 false */
  secondColumnOnly?: boolean;
}

/**
 * 从 CAPABILITIES.md 内容中提取表格列出的条目
 *
 * @param content markdown 内容
 * @returns 文件路径原样 + （可选）目录条目，按出现顺序去重
 */
export function parseCapabilitiesEntries(content: string, options: CapabilitiesParseOptions = {}): string[] {
  const { includeDirs = false, secondColumnOnly = false } = options;
  const entries: string[] = [];

  const fileRegex = secondColumnOnly ? FILE_SECOND_COLUMN_REGEX : FILE_CELL_REGEX;
  let match: RegExpExecArray | null;
  fileRegex.lastIndex = 0;
  while ((match = fileRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    if (!entries.includes(raw)) entries.push(raw);
  }

  if (includeDirs) {
    DIR_CELL_REGEX.lastIndex = 0;
    while ((match = DIR_CELL_REGEX.exec(content)) !== null) {
      const dir = match[1].trim();
      if (!entries.includes(dir)) entries.push(dir);
    }
  }

  return entries;
}

/**
 * 读取并解析 CAPABILITIES.md；文件缺失/不可读时返回 []
 */
export function readCapabilitiesEntries(capabilitiesPath: string, options: CapabilitiesParseOptions = {}): string[] {
  try {
    return parseCapabilitiesEntries(fs.readFileSync(capabilitiesPath, 'utf-8'), options);
  } catch {
    return [];
  }
}
