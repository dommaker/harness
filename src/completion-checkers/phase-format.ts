/**
 * phase-format：提交 subject 的 phase 结构验证（Q4 定稿）
 *
 * 协议（正则写死在函数里，不进配置）：
 * - 全部非 merge commit 的 subject 命中 `^phase\([a-z0-9-]+\):\s+\S`
 * - merge commit 出现即记违规
 * - 阶段名不维护词表不查
 * - 文件分类口径与 tdd-chain 共享（classify.ts），本 checker 不做免检——subject 结构要求覆盖全部非 merge commit
 */

import type { CommitInput, CommitVerdict, CompletionCheckersConfig, PhaseFormatResult } from './types';

/** phase subject 结构（写死） */
export const PHASE_SUBJECT_RE = /^phase\([a-z0-9-]+\):\s+\S/;

/** merge commit 的 subject 启发式（调用方未显式给 isMerge 时兜底） */
const MERGE_SUBJECT_RE = /^Merge\s/;

/** 判定 merge commit：优先 isMerge 显式字段，缺省按 subject 启发式 */
function isMergeCommit(commit: CommitInput): boolean {
  return commit.isMerge ?? MERGE_SUBJECT_RE.test(commit.subject);
}

/** phase 格式验证 */
export function verifyPhaseFormat(
  commits: CommitInput[],
  config: CompletionCheckersConfig = {},
): PhaseFormatResult {
  if (config.enabled === false || config.checkers?.phaseFormat === false) {
    return { checker: 'phase-format', verdict: 'skip', commits: [] };
  }

  const verdicts: CommitVerdict[] = commits.map((commit) => {
    if (isMergeCommit(commit)) {
      return { sha: commit.sha, verdict: 'violation', reason: '提交集内出现 merge commit' };
    }
    if (!PHASE_SUBJECT_RE.test(commit.subject)) {
      return { sha: commit.sha, verdict: 'violation', reason: `subject 不合规：${commit.subject}` };
    }
    return { sha: commit.sha, verdict: 'pass' };
  });

  return {
    checker: 'phase-format',
    verdict: verdicts.some((v) => v.verdict === 'violation') ? 'violation' : 'pass',
    commits: verdicts,
  };
}
