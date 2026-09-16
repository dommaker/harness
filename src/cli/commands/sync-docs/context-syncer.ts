/**
 * CONTEXT.md 同步器（工单 22）：缺失模板生成 + 既有文件发现 + 过时判定
 * + 目录导出面采集（harness#142，供 context-reconcile 的内容判定喂数）
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { DEFAULT_SKIP_DIRS, findTsSourceFiles } from '../../../utils/file-walk';
import { parseExportStatements } from '../../../core/constraints/context-reconcile';
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

/** 目录导出面采集结果（harness#142） */
export interface ContextExportSurface {
  /** 目录内所有 .ts 导出的符号名（值 + 类型，含 barrel 再导出） */
  surface: string[];
  /** `index.ts` barrel 再导出的**值**符号（类型-only 已剔除）；无 index.ts → 空 */
  barrelExports: string[];
}

/** 文件名的导出表：name → typeOnly（口径正本是 context-reconcile 的语句解析） */
type ExportMap = Map<string, boolean>;

/**
 * 把相对 spec 解析为仓内可读的 .ts 文件（`./x` → `x.ts` 或 `x/index.ts`）；
 * 非相对 spec、越出项目根、命中 `.d.ts`/`node_modules`/跳过目录一律 null（不并入导出面）。
 */
function resolveTsTarget(fromFile: string, spec: string, projectPath: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.d.ts')) continue;
    const rel = path.relative(projectPath, candidate);
    if (!rel || rel.startsWith('..') || rel.includes('node_modules')) continue;
    if (rel.split(path.sep).some((segment) => DEFAULT_SKIP_DIRS.includes(segment))) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 单文件导出表（含再导出与 `export *` 展开），memo 化 + 在途集合破环。
 *
 * 递归只沿 `export *` 与具名再导出的来源走，读到的都是仓内 .ts；
 * 环上（A `export * from './b'`、B `export * from './a'`）在途文件交空表，
 * 与 tsc 的星号环语义一致（不因此丢名字——真实名字总有非环上的一条声明路径）。
 */
async function collectFileExports(
  file: string,
  projectPath: string,
  cache: Map<string, ExportMap>,
  inProgress: Set<string>
): Promise<ExportMap> {
  const cached = cache.get(file);
  if (cached) return cached;
  if (inProgress.has(file)) return new Map();
  inProgress.add(file);

  const out: ExportMap = new Map();
  let source: string;
  try {
    source = await fs.readFile(file, 'utf-8');
  } catch {
    inProgress.delete(file);
    cache.set(file, out);
    return out;
  }

  const { symbols, starFrom } = parseExportStatements(source);
  for (const symbol of symbols) {
    let typeOnly = symbol.typeOnly;
    if (symbol.from) {
      const origin = resolveTsTarget(file, symbol.from, projectPath);
      // 环上（origin 在途）时交回的是空表，那是「不知道」不是「没有」→ 不做虚判
      if (origin && !inProgress.has(origin)) {
        const originExports = await collectFileExports(origin, projectPath, cache, inProgress);
        // 正本没有这个本名 → 这条再导出是虚的（改名未跟上的 barrel），不计入导出面，
        // 否则文档里的幽灵会被 barrel 自己洗白（harness#142 反证撞出的口径漏洞）
        if (!originExports.has(symbol.localName)) continue;
        if (!typeOnly && originExports.get(symbol.localName) === true) typeOnly = true;
      }
    }
    out.set(symbol.name, typeOnly);
  }

  for (const spec of starFrom) {
    const target = resolveTsTarget(file, spec, projectPath);
    if (!target) continue;
    const targetExports = await collectFileExports(target, projectPath, cache, inProgress);
    for (const [name, typeOnly] of targetExports) if (!out.has(name)) out.set(name, typeOnly);
  }

  inProgress.delete(file);
  cache.set(file, out);
  return out;
}

/**
 * 采集目录导出面（内容判定的代码侧）：目录内 .ts（排 `__tests__/`、`.d.ts`）的导出符号全集，
 * 以及 barrel（`index.ts`）再导出的值符号清单。fs IO 全在此，判定不在（ADR-0025）。
 */
export async function collectContextExportSurface(
  dirPath: string,
  projectPath: string
): Promise<ContextExportSurface> {
  const files = findTsSourceFiles(dirPath);
  const cache = new Map<string, ExportMap>();
  const surface = new Set<string>();

  for (const file of files) {
    const fileExports = await collectFileExports(file, projectPath, cache, new Set());
    for (const name of fileExports.keys()) surface.add(name);
  }

  const barrelExports: string[] = [];
  const barrelFile = path.join(dirPath, 'index.ts');
  if (files.includes(barrelFile)) {
    const barrel = await collectFileExports(barrelFile, projectPath, cache, new Set());
    for (const [name, typeOnly] of barrel) if (!typeOnly) barrelExports.push(name);
  }

  return { surface: [...surface], barrelExports };
}
