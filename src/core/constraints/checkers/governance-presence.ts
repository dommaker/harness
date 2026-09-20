/**
 * governance_presence：治理契约在场守护（studio #302，ADR 2026-08-21 落点模型）
 *
 * 治理契约正本 = AGENTS.md 手写 `PRESERVE:governance` 段（旧模型仓 = CLAUDE.md
 * Governance Rules 块 / 历史 HARNESS_CONSTRAINTS 注入段，ADR-0029 后注入段不再
 * 生成，残留段仅作历史兼容判据）。PRESERVE 只保「存在」不保「在场」：
 * 段被删除/掏空后 sync-docs 重新生成会静默丢失，此处补「在场」校验。
 *
 * ADR-0001 存在性探测：项目未采用 harness 治理（无 .harness/config.yml）→ skip。
 * 向后兼容：旧模型仓（CLAUDE.md 有治理块、AGENTS.md 无 PRESERVE:governance）→ pass，
 * 不强制迁移；两处都没有才报违规。
 */

import { join } from 'path';
import { loadRawProjectConfig } from '../../project-config-loader';
import { hasGovernanceContract, hasPreserveBlock, readIfExists } from '../injection-writer';
import type { ConstraintCheck } from './types';

/** 治理契约 PRESERVE 段名（ADR 落点模型约定） */
export const GOVERNANCE_PRESERVE_NAME = 'governance';

/** AGENTS.md 是否存在非空 PRESERVE:governance 块（切片判定收口 injection-writer.hasPreserveBlock，#83） */
export function hasGovernancePreserveBlock(agentsMdPath: string): boolean {
  const content = readIfExists(agentsMdPath);
  return content !== null && hasPreserveBlock(content, GOVERNANCE_PRESERVE_NAME);
}

/** CLAUDE.md 是否有治理契约在场（判定收口 injection-writer.hasGovernanceContract，#83；旧模型仓豁免） */
export function hasClaudeGovernance(claudeMdPath: string): boolean {
  const content = readIfExists(claudeMdPath);
  return content !== null && hasGovernanceContract(content);
}

export const governancePresence: ConstraintCheck = {
  id: 'governance_presence',
  async evaluate(env) {
    const projectPath = env.projectPath;

    // 存在性探测：无 harness 配置 = 未采用治理约定 → skip（不计 pass/fail）
    let adopted = false;
    try {
      adopted = loadRawProjectConfig(env) !== undefined;
    } catch {
      adopted = false;
    }
    if (!adopted) return 'skip';

    if (hasGovernancePreserveBlock(join(projectPath, 'AGENTS.md'))) return true;
    if (hasClaudeGovernance(join(projectPath, 'CLAUDE.md'))) return true;

    // 证据随判定一并返回（ADR-0016 补迁）：此前这里是 console.error 侧信道——
    // 只进本地 stderr，进不了 CLI 结论块与 trace，error 级拦截时用户看不到该恢复哪个正本
    return {
      pass: false,
      evidence: [
        '治理契约缺失：AGENTS.md 无非空 PRESERVE:governance 段，CLAUDE.md 也无 Governance Rules 块（正本静默丢失）',
        '修复: 恢复其一——AGENTS.md 补回手写 PRESERVE:governance 段，或 CLAUDE.md 补回 Governance Rules 块',
      ],
    };
  },
};
