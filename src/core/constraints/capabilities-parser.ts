/**
 * CAPABILITIES.md 解析与能力清单计数（工单 19-B / H2 O10-R3）
 *
 * 此前 checker.parseCapabilitiesFiles 与 sync-docs.parseCapabilitiesFiles
 * 各持一份正则，收敛到此处。H2 起能力清单计数（checkCapabilityCounts /
 * updateCapabilityCounts）也从 sync-docs/capabilities-syncer 收敛到此，
 * 使本模块成为 CAPABILITIES.md 解析 + 计数唯一入口。
 */

import * as fs from 'fs';
import { IRON_LAWS, GUIDELINES } from './definitions';
import { FreshnessRunner } from './doc-freshness/runner';
import type { DocFreshnessCheck } from '../../types/project-config';

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

/**
 * 检测 CAPABILITIES.md 是否使用能力清单格式（计数行），而非文件表格格式
 *
 * 清单格式没有文件表可核对，计数由 sync-docs 自动维护，
 * checker 与 sync-docs 都应按此跳过条目级比对。
 */
export function isCapabilityListingFormat(content: string): boolean {
  // 能力清单格式特征：包含 "CLI Commands (N)" / "Iron Laws (N)" 等计数行
  return /CLI Commands\s*\(\d+\)/.test(content) ||
    /Iron Laws?\s*\(\d+\)/.test(content) ||
    /Guidelines?\s*\(\d+\)/.test(content);
}

/**
 * 未覆盖文件的聚合目录（module 模式）
 *
 * 规则：取源码根下的第一级子目录（root=src、file=src/core/foo.ts → src/core/）；
 * 源码根直接下的文件聚到根（file=src/foo.ts → src/）。
 */
export function aggregateToSourceSubdir(root: string, file: string): string {
  if (!root) return file;
  const prefix = root.endsWith('/') ? root : root + '/';
  const rest = file.startsWith(prefix) ? file.slice(prefix.length) : file;
  const idx = rest.indexOf('/');
  if (idx === -1) return prefix;
  return prefix + rest.slice(0, idx) + '/';
}

// ── 能力清单计数 ────────────────────────────────────────────

/**
 * 构建 CAPABILITIES.md 能力清单格式的检查配置
 */
function buildCapabilityChecks(): DocFreshnessCheck[] {
  return [
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'CLI Commands',
      pattern: 'CLI Commands\\s*\\((\\d+)\\)',
      // index.ts（已删 barrel）与 definitions.ts（命令注册表纯数据）不是命令实现，不计入
      actual: { kind: 'dir_count', path: 'src/cli/commands', extension: '.ts', exclude: ['index.ts', 'definitions.ts'] },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Quality Gates',
      pattern: 'Quality Gates?\\s*\\((\\d+)\\)',
      actual: { kind: 'dir_count', path: 'src/gates', extension: '.ts', exclude: ['index.ts', 'types.ts'] },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Iron Laws',
      pattern: 'Iron Laws?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(IRON_LAWS).length },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Guidelines',
      pattern: 'Guidelines?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(GUIDELINES).length },
    },
  ];
}

/**
 * 使用 FreshnessRunner 检查能力清单计数是否与代码一致（--check 模式）
 */
export function checkCapabilityCounts(
  projectPath: string
): { match: boolean; mismatches: string[] } {
  const runner = new FreshnessRunner();
  const checks = buildCapabilityChecks();
  const results = runner.runAll({ checks }, projectPath);

  const mismatches: string[] = [];
  for (const r of results) {
    if (!r.pass && r.message) {
      mismatches.push(r.message);
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

/**
 * 更新 CAPABILITIES.md 中的能力清单计数（write 模式）
 *
 * 使用 FreshnessRunner 获取实际计数，然后 regex 替换文档计数行。
 */
export function updateCapabilityCounts(content: string, projectPath: string): string {
  const runner = new FreshnessRunner();

  const cliCount = runner.countFromDir('src/cli/commands', '.ts', ['index.ts', 'definitions.ts'], projectPath);
  const gateCount = runner.countFromDir('src/gates', '.ts', ['index.ts', 'types.ts'], projectPath);
  const ironCount = Object.keys(IRON_LAWS).length;
  const guideCount = Object.keys(GUIDELINES).length;

  const replacements: [RegExp, string][] = [
    [/CLI Commands\s*\(\d+\)/, `CLI Commands (${cliCount})`],
    [/Quality Gates?\s*\(\d+\)/, `Quality Gates (${gateCount})`],
    [/Iron Laws?\s*\(\d+\)/, `Iron Laws (${ironCount})`],
    [/Guidelines?\s*\(\d+\)/, `Guidelines (${guideCount})`],
  ];

  for (const [regex, replacement] of replacements) {
    if (regex.test(content)) {
      content = content.replace(regex, replacement);
    }
  }

  return content;
}
