/**
 * 发布物完整性自检（harness#77，#75 N4 收编）
 *
 * harness 自己最知道自己发了什么：关键发布物清单不再由外部（studio publishPackage）
 * 或本仓 release 命令各自硬编码 dist 内部文件，而是从包声明面（package.json
 * main/exports/bin）运行时推导 + 少量运行时 extras 随源码维护——目录重构动到
 * 声明面时清单自动跟随，extras 与其描述的文件同仓同评审。
 *
 * 公开面（barrel）：getCriticalArtifacts / verifyReleaseArtifacts。
 * studio publishPackage 的 dist 校验改调本能力，替换硬编码清单（studio#425 配套切换）。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 本包名（包根向上解析的身份锚点，同 bin 名同源） */
export const HARNESS_PACKAGE_NAME = '@dommaker/harness';

/** package.json 发布面形状（只关心与发布物定位相关字段） */
export interface PackagePublishManifest {
  name?: string;
  main?: string;
  bin?: string | Record<string, string>;
  exports?: PackageExports;
}

/** exports 字段形状：字符串叶子 / null（兜底禁用）/ 条件对象递归 */
export type PackageExports = string | null | { [key: string]: PackageExports };

/**
 * 推导之外、随源码维护的运行时关键发布物。
 * 声明面推导只覆盖入口文件；以下入口的运行时依赖由本清单兜底。
 */
export const EXTRA_CRITICAL_ARTIFACTS: readonly string[] = [
  // bin/harness.js 引导期 require 的命令/门禁定义表
  'dist/cli/commands/definitions.js',
  'dist/gates/definitions.js',
  // getToolsDir/getRegistryPath 运行时数据目录（build 脚本 cp -r，tsc 不产出）
  'dist/tools/definitions',
];

const CRITICAL_SUFFIXES = ['.js', '.cjs', '.mjs', '.d.ts'];

function collectExportsLeaves(exportsField: PackageExports | undefined, out: string[]): void {
  if (typeof exportsField === 'string') {
    out.push(exportsField);
    return;
  }
  if (!exportsField || typeof exportsField !== 'object') return;
  for (const value of Object.values(exportsField)) {
    collectExportsLeaves(value, out);
  }
}

/**
 * 从包声明面推导关键发布物清单：main + bin + exports 全部脚本入口。
 * 去 ./ 前缀，剔除非脚本叶子（如 ./package.json 自导出），去重排序。
 */
export function deriveCriticalArtifacts(manifest: PackagePublishManifest): string[] {
  const collected: string[] = [];
  if (manifest.main) collected.push(manifest.main);
  if (typeof manifest.bin === 'string') collected.push(manifest.bin);
  else if (manifest.bin && typeof manifest.bin === 'object') {
    collected.push(...Object.values(manifest.bin));
  }
  collectExportsLeaves(manifest.exports, collected);
  return [...new Set(
    collected
      .map(p => p.replace(/^\.\//, ''))
      .filter(p => CRITICAL_SUFFIXES.some(suffix => p.endsWith(suffix)))
  )].sort();
}

function isHarnessPackageRoot(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    return pkg?.name === HARNESS_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/**
 * 从 fromDir（缺省本模块编译位置）向上解析本包根。
 * 源码仓（src/release → 仓根）与发布包（node_modules/@dommaker/harness/dist/release
 * → 包根）均可达；到文件系统根仍无匹配则抛错。
 */
export function resolvePackageRoot(fromDir: string = __dirname): string {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (isHarnessPackageRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `[harness] 无法从 ${fromDir} 向上定位 ${HARNESS_PACKAGE_NAME} 包根；请显式传入 pkgRoot。`
  );
}

/**
 * 关键发布物清单（相对包根路径，排序去重）。
 * pkgRoot 缺省时自动解析本包根——外部消费者（studio）零参数即自检已安装的 harness。
 */
export function getCriticalArtifacts(pkgRoot?: string): string[] {
  const root = pkgRoot ? path.resolve(pkgRoot) : resolvePackageRoot();
  const manifest: PackagePublishManifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf-8')
  );
  return [...new Set([...deriveCriticalArtifacts(manifest), ...EXTRA_CRITICAL_ARTIFACTS])].sort();
}

export interface ArtifactIntegrityResult {
  ok: boolean;
  pkgRoot: string;
  /** 清单全量（相对包根路径） */
  checked: string[];
  /** 缺失项（相对包根路径） */
  missing: string[];
}

/**
 * 发布物完整性自检：逐项存在性校验（目录/文件均可）。
 * 挂载点：harness release 命令第 4 步；studio publishPackage dist 校验（配套切换 studio#425）。
 */
export function verifyReleaseArtifacts(pkgRoot?: string): ArtifactIntegrityResult {
  const root = pkgRoot ? path.resolve(pkgRoot) : resolvePackageRoot();
  const checked = getCriticalArtifacts(root);
  const missing = checked.filter(f => !fs.existsSync(path.join(root, f)));
  return { ok: missing.length === 0, pkgRoot: root, checked, missing };
}
