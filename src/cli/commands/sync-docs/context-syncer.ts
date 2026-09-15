/**
 * CONTEXT.md 同步器（工单 22）：缺失模板生成 + 既有文件发现 + 过时判定
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DEFAULT_SKIP_DIRS } from '../../../utils/file-walk';
import type { CommandIO } from '../../command-contract';
import {
  contextDocFile,
  nodeScaffoldFs,
  runPlan,
  type ScaffoldFileSystem,
  type ScaffoldOutcome,
} from '../scaffold';

/**
 * 创建 CONTEXT.md 模板：走 scaffold 正本站点（contextDocFile + runPlan），
 * 与 init 的 CONTEXT.md 落点共用同一份模板正文（harness#150，#132 口径外的第 9 处）。
 *
 * 只在 `contextMissing` 的目录上被调用，故正常只走 `created`；若落到 `exists`
 * 说明 sync-docs 的缺失判定与 scaffold 的在场判定口径不一致（不静默兜，交由调用方感知）。
 */
export async function createContextMd(
  projectPath: string,
  dir: string,
  io: CommandIO,
  scaffoldFs: ScaffoldFileSystem = nodeScaffoldFs,
): Promise<ScaffoldOutcome> {
  const [outcome] = await runPlan([contextDocFile(projectPath, dir)], io, scaffoldFs);
  return outcome;
}

/**
 * 自动发现已有 CONTEXT.md 文件的目录（相对于 projectPath）
 */
export async function findExistingContextFiles(projectPath: string, srcDirs: string[]): Promise<string[]> {
  const dirs: string[] = [];

  async function scan(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (DEFAULT_SKIP_DIRS.includes(entry)) continue;
      const entryPath = path.join(dir, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory()) {
        // 检查该目录是否有 CONTEXT.md
        try {
          await fs.access(path.join(entryPath, 'CONTEXT.md'));
          dirs.push(path.relative(projectPath, entryPath));
        } catch {
          // 没有，继续递归
        }
        await scan(entryPath);
      }
    }
  }

  for (const srcDir of srcDirs) {
    await scan(path.join(projectPath, srcDir));
  }
  return dirs;
}

/**
 * 获取目录下最新 .ts 文件的修改时间
 * 返回 null 如果目录不存在或没有 .ts 文件
 */
export async function getLatestTsMtime(dirPath: string): Promise<number | null> {
  let latest: number | null = null;

  async function scan(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (DEFAULT_SKIP_DIRS.includes(entry)) continue;
      const entryPath = path.join(dir, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory()) {
        await scan(entryPath);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        if (latest === null || stat.mtimeMs > latest) {
          latest = stat.mtimeMs;
        }
      }
    }
  }

  await scan(dirPath);
  return latest;
}
