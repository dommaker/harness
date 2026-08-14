/**
 * CLAUDE.md 约束注入段漂移校验（ADR-0001 决策 7）
 *
 * 检测三类漂移：
 * 1. 版本漂移：标记段内 `<!-- version: x -->` ≠ 当前 harness 包版本
 * 2. 内容漂移：标记段实际条目 ≠ renderConstraintsSection(当前生效集, 当前版本)
 *    （手改裁剪 / harness 升级后未重跑 init / config.yml 变更后未同步），
 *    产出条目级差异（missing/extra），比逐行 diff 更可读
 * 3. 重复章节：标记段之外还存在另一个 `## Governance Rules` 标题
 *    （init 旧版本在无标记时追加第二个同名章节的历史问题）
 *
 * 纯检测、只读：不改任何文件。check 仅警告不阻断，详细差异进 report。
 * 文件无标记段 = 未注入，不算漂移（report 一句话提示，check 不警告）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { getEffectiveConstraints } from '../effective-constraints';
import {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
} from './injection-renderer';

/** 注入漂移检测结果 */
export interface InjectionDrift {
  /** 是否存在任一漂移（版本/内容/重复章节） */
  hasDrift: boolean;
  /** CLAUDE.md 不存在或无约束标记段（未注入，不算漂移） */
  notInjected: boolean;
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

/**
 * 检测 CLAUDE.md 约束注入段漂移
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

  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  let content: string;
  try {
    content = fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    result.notInjected = true;
    return result;
  }
  if (typeof content !== 'string') {
    result.notInjected = true;
    return result;
  }

  // 重复章节：全文统计 `## Governance Rules` 标题数（含标记段所属的合法标题）
  const headingCount = (content.match(GOVERNANCE_HEADING_RE) ?? []).length;
  result.duplicateHeading = headingCount > 1;

  const startIdx = content.indexOf(CONSTRAINTS_START_MARKER);
  const endIdx = content.indexOf(CONSTRAINTS_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // 无标记段 = 未注入，不算漂移（check 不警告；duplicateHeading 仍如实记录供 report 提示）
    result.notInjected = true;
    return result;
  }

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
