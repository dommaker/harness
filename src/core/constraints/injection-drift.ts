/**
 * 治理约束注入段漂移校验（ADR-0001 决策 7）
 *
 * 检测三类漂移：
 * 1. 版本漂移：标记段内 `<!-- version: x -->` ≠ 当前 harness 包版本
 * 2. 内容漂移：标记段实际条目 ≠ renderConstraintsSection(当前生效集, 当前版本)
 *    （手改裁剪 / harness 升级后未重跑 init / config.yml 变更后未同步），
 *    产出条目级差异（missing/extra），比逐行 diff 更可读
 * 3. 重复章节：标记段之外还存在另一个 `## Governance Rules` 标题
 *    （init 旧版本在无标记时追加第二个同名章节的历史问题）
 *
 * 落点路由（studio #307，ADR 2026-08-21 落点模型）：注入段可能在
 * CLAUDE.md（旧模型仓）或 AGENTS.md `PRESERVE:governance` 段内（新模型仓），
 * 与 init 的 setupGovernanceConstraints 路由一致——CLAUDE.md 有标记优先。
 *
 * 纯检测、只读：不改任何文件。check 仅警告不阻断，详细差异进 report。
 * 两处均无标记段 = 未注入，不算漂移（report 一句话提示，check 不警告）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { getEffectiveConstraints } from '../effective-constraints';
import {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
} from './injection-renderer';

/** 注入段落点文件名（检测顺序即路由优先级：旧模型仓 CLAUDE.md 豁免优先） */
const INJECTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
export type InjectionFile = (typeof INJECTION_FILES)[number];

/** 注入漂移检测结果 */
export interface InjectionDrift {
  /** 是否存在任一漂移（版本/内容/重复章节） */
  hasDrift: boolean;
  /** CLAUDE.md / AGENTS.md 均无约束标记段（未注入，不算漂移） */
  notInjected: boolean;
  /** 注入段落点文件（未注入时 undefined） */
  injectionFile?: InjectionFile;
  /** 版本漂移：注入段版本 ≠ 当前 harness 版本 */
  versionDrift?: { expected: string; actual: string };
  /**
   * 内容漂移（条目级）：
   * missing = 期望渲染中有、实际段中缺失的条目；extra = 实际段中多出的条目
   */
  contentDrift?: { missing: string[]; extra: string[] };
  /** 标记段之外还存在另一个 `## Governance Rules` 标题 */
  duplicateHeading: boolean;
  /** 修复指引 */
  fixHint: string;
}

/** 修复指引（重跑 init 幂等同步注入段） */
export const INJECTION_DRIFT_FIX_HINT = '重跑 `npx @dommaker/harness init` 同步注入段（漂移仅警告，不阻断）';

const VERSION_LINE_RE = /<!-- version: ([^ ]+) -->/;
const ENTRY_LINE_RE = /^- \*\*.+?\*\*: .+$/;
const GROUP_HEADING_RE = /^### .+$/;
const GOVERNANCE_HEADING_RE = /^## Governance Rules[ \t]*$/gm;

/**
 * 读取当前 harness 包版本（与 init 注入时写入的版本同源）
 */
function getPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 提取参与条目级比对的"有效行"：注入条目（- **id**: text）与分组标题（### ...）。
 * 标记行、版本行、空行不参与——版本单独比对，空行/标记属排版噪音。
 */
function significantLines(section: string): string[] {
  return section
    .split('\n')
    .map(l => l.trim())
    .filter(l => ENTRY_LINE_RE.test(l) || GROUP_HEADING_RE.test(l));
}

function readIfExists(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

/**
 * 解析治理约束注入段落点（studio #307，ADR 2026-08-21 落点模型）
 *
 * 与 init 的 setupGovernanceConstraints 路由一致：CLAUDE.md 含标记段优先
 * （旧模型仓豁免），否则看 AGENTS.md（新模型仓注入段在 PRESERVE:governance 内）；
 * 两处均无完整标记段 → null（未注入）。
 *
 * detectInjectionDrift 与 constraints retire 的注入段同步共用本路由。
 */
export function resolveInjectionTarget(
  projectRoot: string
): { file: InjectionFile; content: string; startIdx: number; endIdx: number } | null {
  for (const file of INJECTION_FILES) {
    const content = readIfExists(path.join(projectRoot, file));
    if (content === null) continue;
    const startIdx = content.indexOf(CONSTRAINTS_START_MARKER);
    const endIdx = content.indexOf(CONSTRAINTS_END_MARKER);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      return { file, content, startIdx, endIdx };
    }
  }
  return null;
}

/**
 * 检测约束注入段漂移
 *
 * @param projectRoot 项目根路径
 * @param currentVersion 当前 harness 版本（缺省读 package.json；测试可显式传入）
 */
export function detectInjectionDrift(
  projectRoot: string,
  currentVersion: string = getPackageVersion()
): InjectionDrift {
  const result: InjectionDrift = {
    hasDrift: false,
    notInjected: false,
    duplicateHeading: false,
    fixHint: INJECTION_DRIFT_FIX_HINT,
  };

  const target = resolveInjectionTarget(projectRoot);
  if (!target) {
    // 两处均无标记段 = 未注入，不算漂移（check 不警告）。
    // 重复章节仍如实记录供 report 提示：旧落点 CLAUDE.md 优先，其次 AGENTS.md。
    const legacy =
      readIfExists(path.join(projectRoot, 'CLAUDE.md')) ??
      readIfExists(path.join(projectRoot, 'AGENTS.md'));
    if (legacy !== null) {
      result.duplicateHeading = (legacy.match(GOVERNANCE_HEADING_RE) ?? []).length > 1;
    }
    result.notInjected = true;
    return result;
  }

  result.injectionFile = target.file;
  const { content, startIdx, endIdx } = target;

  // 重复章节：全文统计 `## Governance Rules` 标题数（含标记段所属的合法标题）
  const headingCount = (content.match(GOVERNANCE_HEADING_RE) ?? []).length;
  result.duplicateHeading = headingCount > 1;

  const actualSection = content.slice(startIdx, endIdx + CONSTRAINTS_END_MARKER.length);

  // 1. 版本漂移
  const versionMatch = VERSION_LINE_RE.exec(actualSection);
  const actualVersion = versionMatch ? versionMatch[1] : '(缺失)';
  if (actualVersion !== currentVersion) {
    result.versionDrift = { expected: currentVersion, actual: actualVersion };
  }

  // 2. 内容漂移（条目级：期望渲染 vs 实际段）
  const expectedSection = renderConstraintsSection(getEffectiveConstraints(projectRoot), currentVersion);
  const expectedLines = new Set(significantLines(expectedSection));
  const actualLines = new Set(significantLines(actualSection));
  const missing = [...expectedLines].filter(l => !actualLines.has(l));
  const extra = [...actualLines].filter(l => !expectedLines.has(l));
  if (missing.length > 0 || extra.length > 0) {
    result.contentDrift = { missing, extra };
  }

  result.hasDrift = Boolean(result.versionDrift) || Boolean(result.contentDrift) || result.duplicateHeading;
  return result;
}
