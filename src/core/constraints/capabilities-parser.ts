/**
 * CAPABILITIES.md 解析与能力清单计数（工单 19-B / H2 O10-R3）
 *
 * 此前 checker.parseCapabilitiesFiles 与 sync-docs.parseCapabilitiesFiles
 * 各持一份正则，收敛到此处。H2 起能力清单计数（checkCapabilityCounts /
 * updateCapabilityCounts）也从 sync-docs/capabilities-syncer 收敛到此，
 * 使本模块成为 CAPABILITIES.md 解析 + 计数唯一入口。
 *
 * 计数所需的命令/门禁定义由调用方注入（harness#88：core 不值导入上层定义表）。
 */

import * as fs from 'fs';
import { IRON_LAWS, GUIDELINES } from './definitions';
import { FreshnessRunner } from './doc-freshness/runner';
import type { DocFreshnessCheck } from '../../types/project-config';

/** 匹配表格单元格中的源码文件条目（如 `src/foo.ts`、`foo.tsx`） */
const FILE_CELL_REGEX = /\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/g;

/**
 * 匹配表格单元格中的目录条目（如 `agents/`）。
 *
 * 仅匹配纯路径样式的单元格（字母/数字/._/-/@ 与 / 组成、以 / 结尾），
 * 否则以 / 结尾的散文描述（如 JSDoc 首行在 "gitRepo /" 处换行）会被误判为
 * 目录条目，导致 --check 永远报「包含已删除的模块」不收敛（2026-08-04 studio PR #44）
 */
const DIR_CELL_REGEX = /\|\s*([\w][\w@./-]*\/)\s*\|/g;

export interface CapabilitiesParseOptions {
  /** 是否同时收集目录条目，默认 false */
  includeDirs?: boolean;
}

/**
 * 从 CAPABILITIES.md 内容中提取表格列出的条目
 *
 * 解析口径（ADR-0009）：表格所有单元格收集；「只看第二列」的历史读法废弃。
 *
 * @param content markdown 内容
 * @returns 文件路径原样 + （可选）目录条目，按出现顺序去重
 */
export function parseCapabilitiesEntries(content: string, options: CapabilitiesParseOptions = {}): string[] {
  const { includeDirs = false } = options;
  const entries: string[] = [];

  let match: RegExpExecArray | null;
  FILE_CELL_REGEX.lastIndex = 0;
  while ((match = FILE_CELL_REGEX.exec(content)) !== null) {
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
 * 调用方注入的定义源（harness#88）
 *
 * core 只消费计数所需的最小形状，不 require 命令表：
 * - commands：非门禁 CLI 命令定义（仅取长度）
 * - gates：门禁定义（仅取长度与「是否带 cli 元数据」）
 *
 * ADR-0002「定义表是命令形状单一来源」不变，只是表的引用方从 core 移到 cli。
 */
export interface CapabilityDefinitionSource {
  commands: readonly unknown[];
  gates: readonly { cli?: unknown }[];
}

/**
 * 能力清单统计规则单份定义（ADR-0008：check/write 两方向共用，
 * 此前 label+pattern 在 buildCapabilityChecks 与 updateCapabilityCounts 各写一遍）
 *
 * - label：CAPABILITIES.md 计数行 label（check 的 DocFreshnessCheck.label +
 *   write 的替换文本前缀，如 `Quality Gates (6)`）
 * - pattern：同时供 check（doc_regex_count 字符串 pattern，捕获组为文档计数）
 *   与 write（编译为替换 regex）
 * - actual：实际计数——命令/门禁来自注入源，约束来自 core 自身定义表
 */
interface CapabilityCountRule {
  label: string;
  pattern: string;
  actual: number;
}

/**
 * 能力清单统计规则（CLI Commands 计数 = 非门禁命令数 + 带 cli 元数据的门禁数）
 */
function capabilityCountRules(source: CapabilityDefinitionSource): CapabilityCountRule[] {
  return [
    {
      label: 'CLI Commands',
      pattern: 'CLI Commands\\s*\\((\\d+)\\)',
      actual: source.commands.length + source.gates.filter(g => g.cli).length,
    },
    { label: 'Quality Gates', pattern: 'Quality Gates?\\s*\\((\\d+)\\)', actual: source.gates.length },
    { label: 'Iron Laws', pattern: 'Iron Laws?\\s*\\((\\d+)\\)', actual: Object.keys(IRON_LAWS).length },
    { label: 'Guidelines', pattern: 'Guidelines?\\s*\\((\\d+)\\)', actual: Object.keys(GUIDELINES).length },
  ];
}

/**
 * 构建 CAPABILITIES.md 能力清单格式的检查配置
 */
function buildCapabilityChecks(source: CapabilityDefinitionSource): DocFreshnessCheck[] {
  return capabilityCountRules(source).map(rule => ({
    type: 'doc_regex_count' as const,
    doc: 'CAPABILITIES.md',
    label: rule.label,
    pattern: rule.pattern,
    actual: { kind: 'const_count' as const, value: rule.actual },
  }));
}

/**
 * 使用 FreshnessRunner 检查能力清单计数是否与代码一致（--check 模式）
 */
export function checkCapabilityCounts(
  projectPath: string,
  source: CapabilityDefinitionSource
): { match: boolean; mismatches: string[] } {
  const runner = new FreshnessRunner();
  const checks = buildCapabilityChecks(source);
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
 * 命令/门禁计数取自注入的定义源（ADR-0002 单一来源在调用方），regex 替换文档计数行；
 * 规则与 check 方向共用 capabilityCountRules（ADR-0008）。
 */
export function updateCapabilityCounts(
  content: string,
  source: CapabilityDefinitionSource
): string {
  for (const rule of capabilityCountRules(source)) {
    const regex = new RegExp(rule.pattern);
    if (regex.test(content)) {
      content = content.replace(regex, `${rule.label} (${rule.actual})`);
    }
  }

  return content;
}
