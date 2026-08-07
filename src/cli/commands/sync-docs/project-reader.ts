/**
 * 项目读取器（工单 22）：package.json / config.yml / 源码结构的项目信息提取
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { loadRawProjectConfig } from '../../../core/project-config-loader';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { findTsSourceFiles } from '../../../utils/file-walk';

export interface ModuleInfo {
  name: string;
  file: string;
  description: string;
}

export interface SyncResult {
  added: string[];
  removed: string[];
  contextMissing: string[];
  contextStale: string[];
}

export interface PackageJsonLite {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
}

/** 读取 package.json（不存在或无法解析时返回 null） */
export async function readPackageJsonLite(dir: string): Promise<PackageJsonLite | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8')) as PackageJsonLite;
  } catch {
    return null;
  }
}

/** 从 .harness/config.yml 读取项目描述（package.json 无 description 时的兜底） */
export async function getConfigDescription(projectPath: string): Promise<string> {
  try {
    const config = loadRawProjectConfig(projectPath);
    return typeof config?.description === 'string' ? config.description : '';
  } catch {
    return '';
  }
}

/** 检测包管理器（决定命令前缀）：pnpm workspace/lockfile → yarn lockfile → 默认 npm */
export function detectPackageManager(projectPath: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(projectPath, 'pnpm-workspace.yaml')) || existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** 格式化脚本调用方式（npm 的 start/test 可省略 run） */
export function formatScriptCommand(pm: 'pnpm' | 'yarn' | 'npm', name: string): string {
  if (pm === 'pnpm') return `pnpm ${name}`;
  if (pm === 'yarn') return `yarn ${name}`;
  return name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`;
}

/**
 * 获取需要 CONTEXT.md 的目录列表
 */
export async function getRequiredContextDirs(projectPath: string): Promise<string[]> {
  try {
    const config = loadRawProjectConfig(projectPath) ?? {};
    const governance = config.governance as Record<string, unknown> | undefined;
    const contextFiles = governance?.context_files as Record<string, unknown> | undefined;
    if (contextFiles?.enabled) {
      if (Array.isArray(contextFiles.required_dirs) && contextFiles.required_dirs.length > 0) {
        return contextFiles.required_dirs as string[];
      }
      // Fallback: auto-discover from source roots
      return detectSourceRoots(projectPath);
    }
  } catch {
    // 配置不存在或无法解析
  }
  return [];
}

/**
 * 获取源码扫描目录列表
 * 优先从 governance.context_files.required_dirs 读取，默认 ['src']
 */
export async function getSourceDirs(projectPath: string): Promise<string[]> {
  const requiredDirs = await getRequiredContextDirs(projectPath);
  if (requiredDirs.length > 0) return requiredDirs;
  return detectSourceRoots(projectPath);
}

/**
 * 扫描源码目录，提取模块信息
 */
export async function scanSourceModules(srcDir: string, projectPath: string): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(srcDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    // 跳过测试目录和非源码目录
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;

    const entryPath = path.join(srcDir, entry);
    const stat = await fs.stat(entryPath);

    if (stat.isDirectory()) {
      // 子目录：递归扫描 .ts 文件（不报告目录条目本身）
      const subFiles = findTsSourceFiles(entryPath, { skipIndex: true });
      for (const f of subFiles) {
        modules.push({
          name: path.basename(f, '.ts'),
          file: path.relative(projectPath, f),
          description: await extractFileDescription(f),
        });
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && entry !== 'index.ts') {
      modules.push({
        name: path.basename(entry, '.ts'),
        file: path.relative(projectPath, entryPath),
        description: await extractFileDescription(entryPath),
      });
    }
  }

  return modules;
}

/**
 * 从文件提取描述
 */
async function extractFileDescription(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return extractFirstComment(content) || path.basename(filePath, '.ts');
  } catch {
    return path.basename(filePath, '.ts');
  }
}

/**
 * 提取文件第一行注释
 */
function extractFirstComment(content: string): string | null {
  // 匹配 /** ... */ 或 // ...
  const jsdocMatch = content.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/);
  if (jsdocMatch) return jsdocMatch[1];

  const lineMatch = content.match(/^\/\/\s*(.+)$/m);
  if (lineMatch) return lineMatch[1];

  return null;
}
