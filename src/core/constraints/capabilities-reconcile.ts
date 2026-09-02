/**
 * CAPABILITIES.md 声明与代码实况的对照判定（ADR-0009）
 *
 * 纯判定 module：吃「文档内容 + 实际文件清单（+ 增量清单）」，一次产出全部判定结果；
 * 不做任何 fs/git IO（存在性可选注入）。此前同一套覆盖/幽灵规则在
 * capability_sync / docs_freshness / sync-docs 三处独立实现，靠「同规则」注释人工同步，
 * 同一 bug（basename 碰撞、后缀误配）在多处各修一遍——此处为唯一真相源。
 *
 * 方向：
 *   代码→文档  uncoveredChanges / uncoveredFiles / uncoveredDirs（漏登记）
 *   文档→代码  deadEntries（幽灵：文档登记的路径既不在代码实况中、文件系统中也不存在）
 *
 * 解析口径（ADR-0009）：表格所有单元格收集，文件条目与目录条目都参与覆盖；
 * 「只看第二列」的历史读法废弃。幽灵判定同样覆盖文件与目录条目（口径从严）。
 * mode=module / file 的差异不在判定层，而是调用方取哪份输出形状：
 * module 读 uncoveredDirs（目录聚合），file 读 uncoveredFiles（逐文件）。
 */

import { join, relative } from 'path';
import {
  aggregateToSourceSubdir,
  isCapabilityListingFormat,
  parseCapabilitiesEntries,
} from './capabilities-parser';
import { findTsSourceFiles } from '../../utils/file-walk';

/** markdown 表格分隔行（|------|------|）：区分「无表格的散文文档」与「有表格但零条目」 */
const TABLE_SEPARATOR_REGEX = /^\s*\|[\s:|-]+\|\s*$/m;

export interface ReconcileInput {
  /** CAPABILITIES.md 内容 */
  content: string;
  /** 代码实况全集：项目相对路径的源文件清单（由调用方收集，见 collectSourceFiles） */
  populationFiles: string[];
  /** 增量变更文件（项目相对路径）；无 git 概念的消费方传空/不传 */
  changedFiles?: string[];
  /** 存在性 oracle（项目相对路径 → 是否存在）；缺省退化为「代码实况兜底」 */
  fileExists?: (relPath: string) => boolean;
  /** 源码根（如 'src'、'apps/api/src'）：未覆盖聚合与条目多根相对路径解析用 */
  sourceRoots?: string[];
}

export interface CapabilityVerdict {
  /** 文档中的文件条目（原样路径，可能为全路径或裸文件名） */
  fileEntries: string[];
  /** 文档中的目录条目（以 / 结尾） */
  dirEntries: string[];
  /** 参与覆盖判定的条目集 = 文件条目 + 目录条目 */
  coverageEntries: string[];
  /** 文档含 markdown 表格（区分「散文文档」与「有表格零条目」） */
  hasTable: boolean;
  /** 能力清单格式（计数行文档）：无文件表可核对，调用方据此短路 */
  listingFormat: boolean;
  /** 增量文件中未被覆盖的（capability_sync Step1） */
  uncoveredChanges: string[];
  /** 代码实况中未被文档登记的 */
  uncoveredFiles: string[];
  /** 未覆盖文件按源码根下第一级子目录聚合（module 模式的 added 形状） */
  uncoveredDirs: string[];
  /** 幽灵条目（文件 + 目录）：文档登记但代码实况与文件系统均不存在 */
  deadEntries: string[];
}

/**
 * 变更文件是否被条目覆盖（ADR-0009 唯一覆盖规则）
 *
 * 目录条目（以 / 结尾）前缀匹配；文件条目精确匹配或路径边界后缀匹配
 * （兼容 basename 条目，但拒绝 xfoo.ts 命中 foo.ts、docs/src/foo.tsx 命中 src/foo.ts
 * 这类 endsWith/includes 模糊匹配造成的碰撞）
 */
function isCoveredBy(entries: string[], file: string): boolean {
  return entries.some((listed) =>
    listed.endsWith('/')
      ? file.startsWith(listed)
      : file === listed || file.endsWith('/' + listed)
  );
}

/** 条目多根相对路径的存在性：项目根直查 + 各源码根前缀（docs_freshness/sync-docs 历史同语义） */
function entryExistsOnDisk(
  entry: string,
  fileExists: (rel: string) => boolean,
  sourceRoots: string[]
): boolean {
  if (fileExists(entry)) return true;
  return sourceRoots.some((root) => fileExists(`${root}/${entry}`));
}

export function reconcileCapabilities(input: ReconcileInput): CapabilityVerdict {
  const {
    content,
    populationFiles,
    changedFiles = [],
    fileExists = () => false,
    sourceRoots = [],
  } = input;

  const allEntries = parseCapabilitiesEntries(content, { includeDirs: true });
  const fileEntries = allEntries.filter((e) => !e.endsWith('/'));
  const dirEntries = allEntries.filter((e) => e.endsWith('/'));
  const coverageEntries = [...fileEntries, ...dirEntries];

  const uncoveredFiles = populationFiles.filter((f) => !isCoveredBy(coverageEntries, f));
  const uncoveredDirs = [...new Set(
    uncoveredFiles.map((file) => {
      // 与 sync-docs 历史聚合同语义：归属第一个能前缀匹配的来源根，兜底首根
      const root = sourceRoots.find((d) => file.startsWith(d + '/')) || sourceRoots[0] || '';
      return aggregateToSourceSubdir(root, file);
    })
  )];

  // 条目在代码实况中仍有对应文件即算活（裸文件名条目无法做存在性判定的兜底）
  const aliveByPopulation = (entry: string): boolean =>
    populationFiles.some((f) => isCoveredBy([entry], f));

  const deadEntries = allEntries.filter((entry) => {
    if (entryExistsOnDisk(entry, fileExists, sourceRoots)) return false;
    return !aliveByPopulation(entry);
  });

  return {
    fileEntries,
    dirEntries,
    coverageEntries,
    hasTable: TABLE_SEPARATOR_REGEX.test(content),
    listingFormat: isCapabilityListingFormat(content),
    uncoveredChanges: changedFiles.filter((f) => !isCoveredBy(coverageEntries, f)),
    uncoveredFiles,
    uncoveredDirs,
    deadEntries,
  };
}

/**
 * 变更清单中的「有意义的代码变更」：仅 .ts/.tsx/.js 且非测试文件
 * （capability_sync Step1 的历史过滤规则，收口于此）
 */
export function significantCodeChanges(diffNames: string[]): string[] {
  return diffNames
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js'))
    .filter((f) => !f.includes('__tests__') && !f.includes('.test.') && !f.includes('.spec.'));
}

/**
 * 收集源码根下的实际文件清单（项目相对路径）
 *
 * 对 utils/file-walk 的统一封装，替代各调用方自拼 join/relative。
 * 扩展名口径保持各调用方现状（checker 不含 .tsx；sync-docs 的模块扫描需
 * ModuleInfo 元数据，继续走 scanSourceModules）——统一扩展名口径属行为变更，
 * 不在本次纯重构范围（ADR-0009 记录在案）。
 */
export function collectSourceFiles(
  projectPath: string,
  roots: string[],
  options: { includeTsx?: boolean } = {}
): string[] {
  const files: string[] = [];
  for (const root of roots) {
    const found = findTsSourceFiles(join(projectPath, root), {
      skipIndex: true,
      includeTsx: options.includeTsx,
    });
    files.push(...found.map((f) => relative(projectPath, f)));
  }
  return files;
}
