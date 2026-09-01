/**
 * tdd-chain：实现 commit 的测试引用链验证（Q2/Q3 定稿）
 *
 * 协议（写死为机制本体，不进配置）：
 * - 实现 commit 必须带 trailer `Tested-By: <sha>`
 * - 被引 sha 须 a) 在本提交集内 b) 序列位置在本 commit 之前（比位置不比时间戳）c) 其文件清单命中 test_globs
 * - 豁免：trailer `Tests: none` → waiver（放行记台账）；纯非代码/纯测试 commit 天然免检
 */

import type { CommitInput, CommitVerdict, CompletionCheckersConfig, TddChainResult } from './types';
import { classifyCommitFiles, resolveGlobs } from './classify';

/** Tested-By 引用协议（写死） */
export const TESTED_BY_RE = /^Tested-By:\s*([0-9a-f]{7,40})\s*$/gim;

/** Tests: none 豁免协议（写死） */
export const TESTS_NONE_RE = /^Tests:\s*none\s*$/im;

/** 引用链验证：伪造引用（不存在 / 位置在后 / 不含测试文件）一律记 violation */
export function verifyTddChain(
  commits: CommitInput[],
  config: CompletionCheckersConfig = {},
): TddChainResult {
  if (config.enabled === false || config.checkers?.tddChain === false) {
    return { checker: 'tdd-chain', verdict: 'skip', commits: [] };
  }

  const { testGlobs, noncodeGlobs } = resolveGlobs(config);
  // 文件分类一次性算好，与同批 commit 的其他 checker 共享口径
  const classifications = commits.map((c) => classifyCommitFiles(c, testGlobs, noncodeGlobs));

  const verdicts: CommitVerdict[] = commits.map((commit, i) => {
    if (classifications[i].exempt) {
      return { sha: commit.sha, verdict: 'skip', reason: '纯测试/纯非代码 commit，天然免检' };
    }
    if (TESTS_NONE_RE.test(commit.body)) {
      return { sha: commit.sha, verdict: 'waiver', reason: 'Tests: none 显式豁免' };
    }
    TESTED_BY_RE.lastIndex = 0;
    const m = TESTED_BY_RE.exec(commit.body);
    if (!m) {
      return { sha: commit.sha, verdict: 'violation', reason: '缺 Tested-By trailer 且未声明 Tests: none' };
    }
    const ref = m[1].toLowerCase();
    const j = commits.findIndex((c) => c.sha.toLowerCase().startsWith(ref));
    if (j === -1) {
      return { sha: commit.sha, verdict: 'violation', reason: `Tested-By 引用 ${ref} 不在本提交集内` };
    }
    if (j >= i) {
      return { sha: commit.sha, verdict: 'violation', reason: `Tested-By 引用 ${ref} 位置不在本 commit 之前` };
    }
    if (!classifications[j].hasTests) {
      return { sha: commit.sha, verdict: 'violation', reason: `被引 commit ${ref} 文件清单未命中 test_globs` };
    }
    return { sha: commit.sha, verdict: 'pass' };
  });

  return {
    checker: 'tdd-chain',
    verdict: verdicts.some((v) => v.verdict === 'violation') ? 'violation' : 'pass',
    commits: verdicts,
  };
}
