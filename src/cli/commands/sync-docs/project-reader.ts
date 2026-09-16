/**
 * 项目读取器（工单 22）：package.json / config.yml / 源码结构的项目信息提取
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { loadRawProjectConfig, resolveContextFiles } from '../../../core/project-config-loader';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { DEFAULT_SKIP_DIRS, findTsSourceFiles, isTsSourceFile } from '../../../utils/file-walk';

export interface ModuleInfo {
  name: string;
  file: string;
  description: string;
}

/** 描述提取的并发上限（#147 固定缺省，按票下裁决不做成配置面） */
const DESCRIPTION_CONCURRENCY = 16;

/**
 * CONTEXT.md「核心导出」节与目录导出面的内容漂移（harness#142 / ADR-0025）。
 * 两清单任一非空即漂移；判定本体在 core/constraints/context-reconcile。
 */
export interface ContextContentDrift {
  dir: string;
  /** 幽灵：文档声明、导出面已无 */
  ghosts: string[];
  /** 未登记：barrel 公开值符号未进「核心导出」节 */
  unlisted: string[];
}

export interface SyncResult {
  added: string[];
  removed: string[];
  contextMissing: string[];
  /** mtime 提示（源码比文档新）：不参与判定，只在本地给提示 */
  contextStale: string[];
  contextContentDrift: ContextContentDrift[];
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
 *
 * context_files 三态语义（工单 84）：enabled 且非空 → 配置目录；
 * enabled 但无目标 → 工具流兜底回落自动探测（回落保留在调用方，不进访问器）；
 * 未配置 → 空列表。
 */
export async function getRequiredContextDirs(projectPath: string): Promise<string[]> {
  const resolution = resolveContextFiles(projectPath);
  if (resolution.state === 'enabled') {
    return resolution.dirs;
  }
  if (resolution.state === 'enabled-empty') {
    // Fallback: auto-discover from source roots
    return detectSourceRoots(projectPath);
  }
  return [];
}

/**
 * 获取源码扫描目录列表
 * 优先从 governance.context_files.required_dirs 读取；未配置或配置为空时
 * 回落自动探测（detectSourceRoots），并非固定 ['src']
 */
export async function getSourceDirs(projectPath: string): Promise<string[]> {
  const requiredDirs = await getRequiredContextDirs(projectPath);
  if (requiredDirs.length > 0) return requiredDirs;
  return detectSourceRoots(projectPath);
}

/**
 * 扫描源码目录，提取模块信息（harness#147：路径与描述分两步取）
 *
 * 第一步定清单（目录遍历序，逐字保持改造前口径），第二步并发取描述并按**原索引**回填
 * ——清单顺序是对外可见面（`--check` 逐行比对生成的表格），不随读取完成先后漂移。
 */
export async function scanSourceModules(srcDir: string, projectPath: string): Promise<ModuleInfo[]> {
  const found: { absPath: string; name: string; file: string }[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(srcDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    // 跳过依赖/旁测/构建产物目录（名单正本见 utils/file-walk）
    if (DEFAULT_SKIP_DIRS.includes(entry)) continue;

    const entryPath = path.join(srcDir, entry);
    const stat = await fs.stat(entryPath);

    if (stat.isDirectory()) {
      // 子目录：递归扫描 .ts/.tsx 文件（不报告目录条目本身）
      // includeTsx 开启后，历史项目未登记过的 .tsx 会首次批量进入 added（#33 已知连带，
      // 与 .ts 同口径属预期，一次性补登记即可）
      const subFiles = findTsSourceFiles(entryPath, { skipIndex: true, includeTsx: true });
      for (const f of subFiles) {
        found.push({
          absPath: f,
          name: path.basename(f, path.extname(f)),
          file: path.relative(projectPath, f),
        });
      }
    } else if (isTsSourceFile(entry, { skipIndex: true, includeTsx: true })) {
      found.push({
        absPath: entryPath,
        name: path.basename(entry, path.extname(entry)),
        file: path.relative(projectPath, entryPath),
      });
    }
  }

  const descriptions = await extractFileDescriptions(found.map((m) => m.absPath));
  return found.map((m, i) => ({ name: m.name, file: m.file, description: descriptions[i] }));
}

/**
 * 批量提取首行注释描述：并发取数、按索引回填（harness#147）
 *
 * 返回数组与入参同序同长，故调用方拿到的是「问哪份文件答哪份文件」。
 * 上限是固定缺省（不是配置面）：描述提取是几百次小文件读，再放大并发只会压线程池。
 */
export async function extractFileDescriptions(filePaths: string[]): Promise<string[]> {
  const descriptions = new Array<string>(filePaths.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < filePaths.length) {
      const index = cursor++;
      descriptions[index] = await extractFileDescription(filePaths[index]);
    }
  }

  const workers = Math.min(DESCRIPTION_CONCURRENCY, filePaths.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return descriptions;
}

/**
 * 从文件提取描述
 */
async function extractFileDescription(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return extractFirstComment(content) || path.basename(filePath, path.extname(filePath));
  } catch {
    return path.basename(filePath, path.extname(filePath));
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
