/**
 * 文件遍历工具（工单 19）
 *
 * 收敛此前散落在 sync-docs / cross-project-checker / checker /
 * spec-baseline-check / doc-freshness-check 中的 5 处递归遍历实现。
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileWalkOptions {
  /** 需要整体跳过的目录名（精确匹配） */
  skipDirs?: string[];
  /** 是否跳过 `.` 开头的条目，默认 false */
  skipHidden?: boolean;
  /** 文件过滤器（文件名, 完整路径）；缺省收集所有文件 */
  filter?: (fileName: string, fullPath: string) => boolean;
}

/**
 * 递归收集 root 下的文件路径（同步）
 *
 * 目录不可读时静默跳过（与原各处实现行为一致）。
 */
export function walkFiles(root: string, options: FileWalkOptions = {}): string[] {
  const { skipDirs = [], skipHidden = false, filter } = options;
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (skipHidden && entry.name.startsWith('.')) continue;
    if (skipDirs.includes(entry.name)) continue;

    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, options));
    } else if (entry.isFile()) {
      if (!filter || filter(entry.name, fullPath)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export interface TsSourceWalkOptions {
  /** 是否跳过 barrel 文件 index.ts，默认 false */
  skipIndex?: boolean;
  /** 跳过的目录名，默认 node_modules/__tests__/dist */
  skipDirs?: string[];
  /** 是否跳过 `.` 开头的条目，默认 false */
  skipHidden?: boolean;
}

/**
 * 递归收集 TypeScript 源文件（.ts，排除 .d.ts）
 */
export function findTsSourceFiles(root: string, options: TsSourceWalkOptions = {}): string[] {
  const {
    skipIndex = false,
    skipDirs = ['node_modules', '__tests__', 'dist'],
    skipHidden = false,
  } = options;

  return walkFiles(root, {
    skipDirs,
    skipHidden,
    filter: (name) =>
      name.endsWith('.ts') && !name.endsWith('.d.ts') && (!skipIndex || name !== 'index.ts'),
  });
}
