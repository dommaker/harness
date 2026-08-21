/**
 * governance_presence：治理契约在场守护（studio #302，ADR 2026-08-21 落点模型）
 *
 * 治理契约正本 = AGENTS.md 手写 `PRESERVE:governance` 段（旧模型仓 = CLAUDE.md
 * Governance Rules / HARNESS_CONSTRAINTS 注入段）。PRESERVE 只保「存在」不保「在场」：
 * 段被删除/掏空后 sync-docs 重新生成会静默丢失，此处补「在场」校验。
 *
 * ADR-0001 存在性探测：项目未采用 harness 治理（无 .harness/config.yml）→ skip。
 * 向后兼容：旧模型仓（CLAUDE.md 有治理块、AGENTS.md 无 PRESERVE:governance）→ pass，
 * 不强制迁移；两处都没有才报违规。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { loadRawProjectConfig } from '../../project-config-loader';
import type { ConstraintCheck } from './types';

/** 治理契约 PRESERVE 段名（ADR 落点模型约定） */
export const GOVERNANCE_PRESERVE_NAME = 'governance';

const GOVERNANCE_BEGIN_RE = /^<!-- PRESERVE:governance -->\s*$/m;

/** AGENTS.md 是否存在非空 PRESERVE:governance 块（标记须独占一行，与 preserve-block.ts 同语义） */
export function hasGovernancePreserveBlock(agentsMdPath: string): boolean {
  let content: string;
  try {
    content = readFileSync(agentsMdPath, 'utf-8');
  } catch {
    return false;
  }
  const beginMatch = GOVERNANCE_BEGIN_RE.exec(content);
  if (!beginMatch) return false;
  const rest = content.slice(beginMatch.index + beginMatch[0].length);
  const endIdx = rest.indexOf(`<!-- /PRESERVE:${GOVERNANCE_PRESERVE_NAME} -->`);
  if (endIdx === -1) return false;
  // 块体（首尾标记之间）去空白后非空才算「在场」
  return rest.slice(0, endIdx).trim().length > 0;
}

/** CLAUDE.md 是否存在治理块（与 agents-syncer getGovernanceInfo 同判定，旧模型仓豁免） */
export function hasClaudeGovernance(claudeMdPath: string): boolean {
  let content: string;
  try {
    content = readFileSync(claudeMdPath, 'utf-8');
  } catch {
    return false;
  }
  return /^##\s+Governance Rules/m.test(content) || content.includes('HARNESS_CONSTRAINTS_START');
}

export const governancePresence: ConstraintCheck = {
  id: 'governance_presence',
  async evaluate(env) {
    const projectPath = env.projectPath;

    // 存在性探测：无 harness 配置 = 未采用治理约定 → skip（不计 pass/fail）
    let adopted = false;
    try {
      adopted = loadRawProjectConfig(projectPath) !== undefined;
    } catch {
      adopted = false;
    }
    if (!adopted) return 'skip';

    if (hasGovernancePreserveBlock(join(projectPath, 'AGENTS.md'))) return true;
    if (hasClaudeGovernance(join(projectPath, 'CLAUDE.md'))) return true;

    console.error(
      '[governance_presence] 治理契约缺失：AGENTS.md 无非空 PRESERVE:governance 段，' +
      '且 CLAUDE.md 无 Governance Rules 块——约束正本静默丢失，请恢复其一'
    );
    return false;
  },
};
