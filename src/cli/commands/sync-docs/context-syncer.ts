/**
 * CONTEXT.md 同步器（工单 22）：缺失模板生成 + 既有文件发现 + 过时判定
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 创建 CONTEXT.md 模板
 */
export async function createContextMd(projectPath: string, dir: string): Promise<void> {
  const contextPath = path.join(projectPath, dir, 'CONTEXT.md');
  const dirName = path.basename(dir);

  const content = `# ${dirName}

> 此文件描述 ${dir} 目录的职责和上下文。
> 请阅读本目录的源代码，然后填写以下各节。
> 如果使用 AI 编码助手，将本文件内容作为 prompt 请求它分析并填写。

## 职责

本目录的核心职责是？

## 核心导出

本目录对外暴露的主要模块/函数：

## 依赖关系

本目录依赖哪些其他模块，谁依赖本目录？

## 注意事项

开发时需要注意的约束或约定：
`;

  await fs.mkdir(path.join(projectPath, dir), { recursive: true });
  await fs.writeFile(contextPath, content, 'utf-8');
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
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
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
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
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
